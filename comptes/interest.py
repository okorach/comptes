"""Yield calculation. Replaces the Excel Goal Seek on the 'Interests' sheet.

Model (identical to the sheet): find the annual rate r so that
    opening_balance*(1+p)^N + sum(deposit_i*(1+p)^n_i) == closing_balance
where p=(1+r)^(period/365)-1, N=floor((end-start)/period) and for each deposit
n_i=floor((end-date_i [+period if withdrawal])/period); deposits outside (start,end]
are ignored, and those with n_i<=0 are added at face value.
"""
import datetime as dt
from bisect import bisect_right

EPS = 1e-12


def _days(a, b):
    return (b - a).total_seconds() / 86400.0


def _floor(x):
    return int(x // 1)


def rate_for_period(balances, deposits, start, end, period):
    """balances: sorted [(date, bal)], deposits: [(date, amount)], start/end: datetimes. Returns annual rate or None."""
    if start >= end or not balances:
        return None
    bd = [b[0] for b in balances]
    i_end = bisect_right(bd, end.date().isoformat())
    if not i_end:
        return None
    target = balances[i_end - 1][1]
    i_st = bisect_right(bd, start.date().isoformat())
    opening = balances[i_st - 1][1] if i_st else 0.0
    n_open = _floor(_days(start, end) / period)
    deps = []
    for d, amt in deposits:
        dd = dt.datetime.fromisoformat(d)
        if dd > end or dd <= start:
            deps.append((None, amt, dd))
        else:
            n = _floor((_days(dd, end) + (period if amt < 0 else 0)) / period)
            deps.append((n, amt, dd))

    def fv(r):
        p = (1 + r) ** (period / 365.0) - 1
        tot = opening * (1 + p) ** n_open
        for n, amt, dd in deps:
            if n is None:
                continue
            tot += amt if n <= 0 else amt * (1 + p) ** n
        return tot

    f = lambda r: fv(r) - target
    lo, hi = -0.99, 50.0
    flo, fhi = f(lo), f(hi)
    if flo == 0: return lo
    if fhi == 0: return hi
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fm = f(mid)
        if abs(fm) < 1e-9:
            return mid
        if flo * fm < 0:
            hi = mid
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def key_interests(con, account, now=None):
    """Return {'y1','y3','y5','y8','y_all'} gross rates (None where not applicable)."""
    now = now or dt.datetime.now()
    a = con.execute("SELECT a.tax, t.interest_period FROM accounts a LEFT JOIN account_types t ON t.name=a.type "
                    "WHERE a.id=?", (account,)).fetchone()
    period = (a["interest_period"] if a and a["interest_period"] else 1)
    deposits = [(r[0], r[1]) for r in con.execute(
        "SELECT date,amount_eur FROM deposits WHERE account=? ORDER BY date", (account,)) if r[1] is not None]
    balances = [(r[0], r[1]) for r in con.execute(
        "SELECT date,balance_eur FROM transactions WHERE account=? AND balance_eur IS NOT NULL ORDER BY date,id", (account,))]
    out = {k: None for k in ("y1", "y3", "y5", "y8", "y_all")}
    if not deposits or not balances:
        return out, period
    first = dt.datetime.fromisoformat(deposits[0][0])
    nbr_years = int(_days(first, now) // 365) + 1
    day = 28 if (now.month == 2 and now.day == 29) else now.day
    for key, n in (("y1", 1), ("y3", 3), ("y5", 5), ("y8", 8)):
        if nbr_years >= n:
            start = dt.datetime(now.year - n, now.month, day)
            out[key] = rate_for_period(balances, deposits, start, now, period)
    out["y_all"] = rate_for_period(balances, deposits, first - dt.timedelta(days=1), now, period)
    return out, period


def recalc(con, account, now=None):
    """Compute key yields and store them net of tax (as the Interests sheet does)."""
    now = now or dt.datetime.now()
    rates, _ = key_interests(con, account, now)
    tax = (con.execute("SELECT tax FROM accounts WHERE id=?", (account,)).fetchone()["tax"]) or 0.0
    rates = {k: (None if v is None else v * (1 - tax)) for k, v in rates.items()}  # stored NET, like the workbook
    con.execute("INSERT OR REPLACE INTO interests VALUES(?,?,?,?,?,?,?)",
                (account, now.isoformat(timespec="seconds"), rates["y1"], rates["y3"], rates["y5"],
                 rates["y8"], rates["y_all"]))
    return rates


YEARLY_TYPES = {"CEL", "LDD", "LDDS", "Livret", "Livret A", "PEL", "Livret Jeune", "Autres"}


def has_interests(acc_type):
    return acc_type not in ("Courant", "Autres", None)


def recalc_all(con, force=False, now=None):
    n = 0
    for a in con.execute("SELECT id,type,status FROM accounts WHERE status='Open'").fetchall():
        if not has_interests(a["type"]):
            continue
        if not force and a["type"] in YEARLY_TYPES:
            continue
        recalc(con, a["id"], now)
        n += 1
    con.commit()
    return n
