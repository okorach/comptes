"""Compare yields with the values stored in the workbook's Interests sheet (computed at 2026-10-16 18:5x)."""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from comptes.db import connect
from comptes import interest

con = connect(sys.argv[1])
worst = 0; n = 0
for r in con.execute("SELECT * FROM interests WHERE calc_date>='2026-10-16' ORDER BY account").fetchall():
    acc = r["account"]
    a = con.execute("SELECT tax FROM accounts WHERE id=?", (acc,)).fetchone()
    if not a: continue
    tax = a["tax"] or 0
    now = dt.datetime.fromisoformat(r["calc_date"])
    rates, _ = interest.key_interests(con, acc, now)
    line = []
    for k in ("y1", "y3", "y5", "y8", "y_all"):
        exp = r[k]; got = None if rates[k] is None else rates[k] * (1 - tax)
        if exp is None or got is None:
            ok = (exp is None and got is None)
            line.append(f"{k}:{'ok' if ok else f'exp={exp} got={got}'}")
        else:
            d = abs(exp - got); worst = max(worst, d); n += 1
            line.append(f"{k}:{'ok' if d < 1e-4 else f'DIFF exp={exp:.5f} got={got:.5f}'}")
    print(f"{acc:22}", " ".join(line))
print("compared", n, "values; worst abs diff", worst)
