"""Exchange rates retrieved from the internet: ECB reference rates, through the Frankfurter API (no key needed).

One rate per week (the first business day of the week) is kept, from the week of the oldest data needing the currency to today.
The weeks that already have a rate (entered by hand or retrieved before) are left alone, so only what is missing is requested.
Rates are units of currency per EUR, like the ones of the `fx_rates` table.
"""
import datetime as dt
import json
import os
import sqlite3
import threading
import urllib.error
import urllib.request
from collections.abc import Callable

from . import calc, ops
from .db import connect

API = "https://api.frankfurter.dev/v1"
FIRST_DATE = dt.date(1999, 1, 4)  # first reference rates of the ECB
TIMEOUT = 15  # seconds
DISABLE_ENV = "COMPTES_NO_FX_UPDATE"  # set to anything to never go on the internet

# (currency, date) of what needs an exchange rate: accounts and deposits in a currency, and transactions in another currency
USAGE_QUERIES = (
    "SELECT a.currency, t.date FROM transactions t JOIN accounts a ON a.id=t.account",
    "SELECT a.currency, d.date FROM deposits d JOIN accounts a ON a.id=d.account",
    "SELECT fx_currency, date FROM transactions WHERE fx_currency IS NOT NULL",
)


class RatesError(Exception):
    """The service answered, but not with the rates (unknown currency, error...)"""


def monday(day: dt.date) -> dt.date:
    """First day of the week of the date"""
    return day - dt.timedelta(days=day.weekday())


def needed_currencies(con: sqlite3.Connection) -> dict[str, str]:
    """{currency: date of the oldest data needing its exchange rate}, EUR (the pivot) excepted.
    The master currency is needed since the very first transaction: everything is expressed in it."""
    oldest: dict[str, str] = {}

    def note(cur: str | None, date: str | None) -> None:
        if cur and date and cur != "EUR" and date[:10] < oldest.get(cur, "9999"):
            oldest[cur] = date[:10]

    for query in USAGE_QUERIES:
        for cur, date in con.execute(query):
            note(cur, date)
    note(calc.master_currency(con), con.execute("SELECT MIN(date) FROM transactions").fetchone()[0])
    return oldest


def weeks_with_rate(con: sqlite3.Connection, currency: str) -> set[dt.date]:
    """First days of the weeks that already have a rate for the currency"""
    return {monday(dt.date.fromisoformat(r[0][:10])) for r in con.execute("SELECT date FROM fx_rates WHERE currency=?", (currency,))}


def missing_weeks(have: set[dt.date], start: dt.date, end: dt.date) -> list[dt.date]:
    """First days of the weeks between start and end without a rate"""
    out = []
    week = monday(start)
    while week <= end:
        if week not in have:
            out.append(week)
        week += dt.timedelta(days=7)
    return out


def weekly_rates(series: dict[str, float], wanted: set[dt.date]) -> dict[str, float]:
    """The first rate (first business day) of each wanted week"""
    out: dict[str, float] = {}
    seen: set[dt.date] = set()
    for date in sorted(series):
        week = monday(dt.date.fromisoformat(date))
        if week in wanted and week not in seen:
            seen.add(week)
            out[date] = series[date]
    return out


def fetch_rates(currency: str, start: dt.date, end: dt.date) -> dict[str, float]:
    """Daily rates (units of currency per EUR) from start to end. OSError when the internet is not reachable."""
    url = f"{API}/{start.isoformat()}..{end.isoformat()}?base=EUR&symbols={currency}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            data = json.load(response)
    except urllib.error.HTTPError as e:
        raise RatesError(f"HTTP {e.code}") from e
    return {date: rates[currency] for date, rates in data["rates"].items() if currency in rates}


def refresh(con: sqlite3.Connection, today: dt.date | None = None, fetch: Callable[[str, dt.date, dt.date], dict[str, float]] | None = None) -> dict:
    """Adds the missing weekly rates of the currencies in use. When there are new ones, the balances and the yields are recomputed.
    Returns {added, currencies: {currency: n}, errors: [...], offline: bool}."""
    fetch = fetch or fetch_rates
    today = today or dt.date.today()
    result: dict = {"added": 0, "currencies": {}, "errors": [], "offline": False}
    for cur, oldest in sorted(needed_currencies(con).items()):
        start = max(FIRST_DATE, monday(dt.date.fromisoformat(oldest)))
        missing = missing_weeks(weeks_with_rate(con, cur), start, today)
        if not missing:
            continue
        try:
            series = fetch(cur, missing[0], today)
        except (RatesError, ValueError, KeyError) as e:
            result["errors"].append(f"{cur}: {e}")
            continue
        except OSError:
            result["offline"] = True
            break
        rows = weekly_rates(series, set(missing))
        con.executemany("INSERT OR IGNORE INTO fx_rates VALUES(?,?,?)", [(cur, date, rate) for date, rate in rows.items()])
        result["currencies"][cur] = len(rows)
        result["added"] += len(rows)
    if result["added"]:
        ops.recompute_everything(con)
    con.commit()
    return result


def describe(result: dict) -> str:
    """One line for the console / the administration page"""
    if result["offline"]:
        return "Pas de connexion Internet : taux de change non mis à jour"
    text = f"{result['added']} taux de change ajoutés" if result["added"] else "Taux de change à jour"
    if result["currencies"]:
        text += " (" + ", ".join(f"{cur} : {n}" for cur, n in sorted(result["currencies"].items())) + ")"
    return text + "".join(f" ; erreur {e}" for e in result["errors"])


def _update(db_path: str) -> None:
    con = connect(db_path)
    try:
        print(describe(refresh(con)), flush=True)
    except Exception as e:  # never let a failure of the update stop the application  # pylint: disable=broad-exception-caught
        print(f"Mise à jour des taux de change impossible : {e}", flush=True)
    finally:
        con.close()


def update_in_background(db_path: str) -> threading.Thread | None:
    """Retrieves the missing rates without delaying the start of the application. Does nothing if COMPTES_NO_FX_UPDATE is set."""
    if os.environ.get(DISABLE_ENV):
        return None
    thread = threading.Thread(target=_update, args=(db_path,), name="fx-update", daemon=True)
    thread.start()
    return thread
