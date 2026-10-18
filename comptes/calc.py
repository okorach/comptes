import datetime as dt
from bisect import bisect_right


def today_iso():
    return dt.date.today().isoformat()


def account_summaries(con, as_of=None):
    """Latest balance (EUR) per account on or before as_of."""
    as_of = as_of or today_iso()
    out = []
    for a in con.execute("SELECT * FROM accounts ORDER BY status DESC, availability, id"):
        t = con.execute(
            "SELECT date,balance_eur,native_balance FROM transactions WHERE account=? AND date<=? "
            "ORDER BY date DESC, id DESC LIMIT 1", (a["id"], as_of)).fetchone()
        out.append({
            "id": a["id"], "bank": a["bank"], "type": a["type"], "currency": a["currency"],
            "status": a["status"], "availability": a["availability"], "mode": a["mode"],
            "in_budget": a["in_budget"],
            "last_date": t["date"] if t else None,
            "balance_eur": t["balance_eur"] if t else 0.0,
            "balance_native": t["native_balance"] if t else 0.0,
        })
    return out


def net_worth_series(con, start="2005-01-01", only_open=False):
    """Month-end total balance (EUR), each account's last known balance carried forward."""
    series = {}
    q = "SELECT id FROM accounts" + (" WHERE status='Open'" if only_open else "")
    for (acc,) in con.execute(q):
        rows = con.execute("SELECT date,balance_eur FROM transactions WHERE account=? AND balance_eur IS NOT NULL "
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
    """Foreign-per-EUR rates; approximate match (last rate on or before the date), like VLOOKUP(...,TRUE)."""
    def __init__(self, con):
        self.d = {}
        for cur, date, rate in con.execute("SELECT currency,date,rate FROM fx_rates ORDER BY currency,date"):
            ds, rs = self.d.setdefault(cur, ([], []))
            ds.append(date); rs.append(rate)

    def rate(self, cur, date):
        if cur == "EUR" or cur is None:
            return 1.0
        ds, rs = self.d.get(cur, ([], []))
        if not ds:
            raise ValueError(f"no FX rates for {cur}")
        i = bisect_right(ds, date)
        return rs[i - 1] if i else rs[0]


def recompute_account(con, acc, fx=None):
    """Recompute EUR/native amounts and balances for one account from its input fields.
    flow/static: native_amount is the input; snapshot: native_balance; shares: qty*price."""
    fx = fx or Fx(con)
    a = con.execute("SELECT currency,mode FROM accounts WHERE id=?", (acc,)).fetchone()
    cur, mode = a["currency"], a["mode"]
    rows = con.execute("SELECT * FROM transactions WHERE account=? ORDER BY date,id", (acc,)).fetchall()
    prev_nb = None; prev_eb = None
    for r in rows:
        rate = fx.rate(cur, r["date"])
        if mode in ("flow", "static"):
            na = r["native_amount"] if r["native_amount"] is not None else 0.0
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
        con.execute("UPDATE transactions SET native_amount=?,native_balance=?,amount_eur=?,balance_eur=? WHERE id=?",
                    (na, nb, ea, eb, r["id"]))
        prev_nb, prev_eb = nb, eb
