"""Spending / budget reports (replaces GenBudget + the Budget, Stats, Ventilation, Etude pivots).

Rules (from the VBA GenBudget macro):
  * only accounts flagged in_budget count; a row's own in_budget value: blank -> normal,
    0 -> excluded, integer N>1 -> amount spread over N months (first part on the original
    date, the others on the 1st of the following months), 1 -> normal.
  * spend = -amount (income is negative).  Categories Salaire, Epargne and Impôts are excluded by default
    (this reproduces the workbook's Budget sheet to the cent).
"""
import datetime as dt
from collections import defaultdict


DEFAULT_EXCLUDE = ("Salaire", "Epargne", "Impôts")


def _add_months(y, m, k):
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def spread_rows(con, until=None):
    """Yield (date_iso, account, category, subcategory, spread_amount, raw_amount, description)."""
    until = until or dt.date.today().isoformat()
    cats = {r[0]: r[1] for r in con.execute("SELECT subcategory,category FROM categories")}
    q = ("SELECT t.date,t.account,t.subcategory,t.amount_eur,t.in_budget,t.description FROM transactions t "
         "JOIN accounts a ON a.id=t.account WHERE a.in_budget=1")
    for d, acc, sub, amt, b, desc in con.execute(q):
        if amt is None or (b is not None and b == 0):
            continue
        cat = cats.get(sub, "(sans catégorie)") if sub else "(sans catégorie)"
        if b is not None and float(b).is_integer() and b > 1:
            n = int(b)
            y, m = int(d[:4]), int(d[5:7])
            for k in range(n):
                if k == 0:
                    dk = d
                else:
                    yy, mm = _add_months(y, m, k)
                    dk = f"{yy:04d}-{mm:02d}-01"
                if dk <= until:
                    yield dk, acc, cat, sub, -amt / n, (-amt if k == 0 else 0.0), desc
        else:
            if d <= until:
                yield d, acc, cat, sub, -amt, -amt, desc


def _period(d, group):
    if group == "year":
        return d[:4]
    if group == "quarter":
        return f"{d[:4]}-T{(int(d[5:7]) + 2) // 3}"
    return d[:7]


def report(con, group="month", months=36, exclude=DEFAULT_EXCLUDE, today=None):
    today = today or dt.date.today()
    y, m = _add_months(today.year, today.month, -(months - 1))
    start = f"{y:04d}-{m:02d}-01"
    spread = defaultdict(float); raw = defaultdict(float)
    cat_tot = defaultdict(float); matrix = defaultdict(lambda: defaultdict(float))
    for d, _acc, cat, _sub, s, r, _desc in spread_rows(con, today.isoformat()):
        if cat in exclude or d < start:
            continue
        p = _period(d, group)
        spread[p] += s
        cat_tot[cat] += s
        matrix[cat][p] += s
        if d >= start:
            raw[_period(d, group)] += r
    periods = sorted(spread)
    series, vals = [], []
    for p in periods:
        vals.append(spread[p])
        avg = sum(vals[-12:]) / len(vals[-12:])
        series.append({"period": p, "spread": round(spread[p], 2), "raw": round(raw[p], 2), "avg12": round(avg, 2)})
    total = sum(cat_tot.values()) or 1.0
    cats = [{"category": c, "total": round(v, 2), "pct": round(v / total, 4)} for c, v in
            sorted(cat_tot.items(), key=lambda x: x[1])[::-1]]
    return {"group": group, "series": series, "categories": cats,
            "matrix": {c: {p: round(v, 2) for p, v in row.items()} for c, row in matrix.items()},
            "excluded": list(exclude)}


def all_categories(con):
    return [r[0] for r in con.execute("SELECT DISTINCT category FROM categories ORDER BY 1")]
