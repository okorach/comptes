import datetime as dt
import sqlite3
from bisect import bisect_right


def today_iso():
    return dt.date.today().isoformat()


DEFAULT_MASTER_CURRENCY = "EUR"


def master_currency(con: sqlite3.Connection) -> str:
    """Currency of the application: the totals, the yields and the balances of all accounts are computed in it"""
    row = con.execute("SELECT value FROM params WHERE key='master_currency'").fetchone()
    return row[0] if row and row[0] else DEFAULT_MASTER_CURRENCY


def account_summaries(con, as_of=None):
    """Latest balance (master currency) per account on or before as_of."""
    as_of = as_of or today_iso()
    out = []
    for a in con.execute("SELECT * FROM accounts ORDER BY status DESC, availability, id"):
        t = con.execute(
            "SELECT date,balance_main,native_balance FROM transactions WHERE account=? AND date<=? "
            "ORDER BY date DESC, id DESC LIMIT 1", (a["id"], as_of)).fetchone()
        out.append({
            "id": a["id"], "bank": a["bank"], "type": a["type"], "currency": a["currency"],
            "status": a["status"], "availability": a["availability"], "mode": a["mode"],
            "in_budget": a["in_budget"],
            "last_date": t["date"] if t else None,
            "balance_main": t["balance_main"] if t else 0.0,
            "balance_native": t["native_balance"] if t else 0.0,
        })
    return out


def net_worth_series(con, start="2005-01-01", only_open=False):
    """Month-end total balance (master currency), each account's last known balance carried forward."""
    series = {}
    q = "SELECT id FROM accounts" + (" WHERE status='Open'" if only_open else "")
    for (acc,) in con.execute(q):
        rows = con.execute("SELECT date,balance_main FROM transactions WHERE account=? AND balance_main IS NOT NULL "
                           "ORDER BY date,id", (acc,)).fetchall()
        if rows:
            series[acc] = ([r[0] for r in rows], [r[1] for r in rows])
    y, m = int(start[:4]), int(start[5:7])
    today = dt.date.today()
    out = []
    while (y, m) <= (today.year, today.month):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = (dt.date(ny, nm, 1) - dt.timedelta(days=1)).isoformat()
        if (y, m) == (today.year, today.month):
            end = today.isoformat()
        total = 0.0
        for dates, bals in series.values():
            i = bisect_right(dates, end)
            if i:
                total += bals[i - 1]
        out.append({"month": f"{y:04d}-{m:02d}", "total": round(total, 2)})
        y, m = ny, nm
    return out


# ---------------------------------------------------------------- FX & recompute
class Fx:
    """Exchange rates. They are stored as units of currency per EUR (the pivot currency, whose rate is 1).
    rate() gives units of currency per unit of the master currency; approximate match (last rate on or before the date),
    like VLOOKUP(...,TRUE)."""
    def __init__(self, con):
        self.master = master_currency(con)
        self.d = {}
        for cur, date, rate in con.execute("SELECT currency,date,rate FROM fx_rates ORDER BY currency,date"):
            ds, rs = self.d.setdefault(cur, ([], []))
            ds.append(date); rs.append(rate)

    def per_eur(self, cur, date):
        if cur == "EUR" or cur is None:
            return 1.0
        ds, rs = self.d.get(cur, ([], []))
        if not ds:
            raise ValueError(f"no FX rates for {cur}")
        i = bisect_right(ds, date)
        return rs[i - 1] if i else rs[0]

    def rate(self, cur, date):
        """Units of cur for 1 unit of the master currency"""
        if cur is None or cur == self.master:
            return 1.0
        return self.per_eur(cur, date) / self.per_eur(self.master, date)


def flow_amount(r: sqlite3.Row, fx: "Fx", rate: float) -> float:
    """Amount of a flow transaction in the currency of the account (`rate` = rate of that currency on the date of the transaction).
    A transaction in another currency without an entered amount is converted from its original amount."""
    if r["fx_auto"] and r["fx_currency"] and r["fx_amount"] is not None:
        return r["fx_amount"] / fx.rate(r["fx_currency"], r["date"]) * rate
    return r["native_amount"] if r["native_amount"] is not None else 0.0


def recompute_account(con, acc, fx=None):
    """Recompute master currency / native amounts and balances for one account from its input fields.
    flow/static: native_amount is the input; snapshot: native_balance; shares: qty*price."""
    fx = fx or Fx(con)
    a = con.execute("SELECT currency,mode FROM accounts WHERE id=?", (acc,)).fetchone()
    cur, mode = a["currency"], a["mode"]
    rows = con.execute("SELECT * FROM transactions WHERE account=? ORDER BY date,id", (acc,)).fetchall()
    prev_nb = None; prev_eb = None
    for r in rows:
        rate = fx.rate(cur, r["date"])
        if mode in ("flow", "static"):
            na = flow_amount(r, fx, rate)
            nb = (prev_nb or 0.0) + na
            ab, eb = na / rate, nb / rate
            ea = ab
        else:
            nb = r["qty"] * r["price"] if mode == "shares" and r["qty"] is not None and r["price"] is not None else r["native_balance"]
            if nb is None:
                nb = prev_nb or 0.0
            na = nb - (prev_nb or 0.0)
            eb = nb / rate
            ea = eb - (prev_eb or 0.0)
        con.execute("UPDATE transactions SET native_amount=?,native_balance=?,amount_main=?,balance_main=? WHERE id=?",
                    (na, nb, ea, eb, r["id"]))
        prev_nb, prev_eb = nb, eb
