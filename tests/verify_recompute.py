"""Check that recompute_account reproduces the values imported from Excel (read-only on the DB copy)."""
import sys, shutil, tempfile, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from comptes.db import connect
from comptes import calc

src = sys.argv[1]
tmp = tempfile.mktemp(suffix=".db"); shutil.copy(src, tmp)
con = connect(tmp)
fx = calc.Fx(con)
bad = 0
for (acc,) in con.execute("SELECT id FROM accounts").fetchall():
    before = [(r["id"], r["amount_eur"], r["balance_eur"]) for r in con.execute("SELECT id,amount_eur,balance_eur FROM transactions WHERE account=? ORDER BY date,id", (acc,))]
    if not before: continue
    try:
        calc.recompute_account(con, acc, fx)
    except Exception as e:
        print("ERR", acc, e); bad += 1; continue
    after = {r["id"]: (r["amount_eur"], r["balance_eur"]) for r in con.execute("SELECT id,amount_eur,balance_eur FROM transactions WHERE account=?", (acc,))}
    dm = db = 0; worst = (0, None)
    for i, a, b in before:
        na, nb = after[i]
        if a is not None and abs(na - a) > 0.01: dm += 1
        if b is not None and abs(nb - b) > 0.01:
            db += 1
            if abs(nb - b) > worst[0]: worst = (abs(nb - b), i)
    mode = con.execute("SELECT mode FROM accounts WHERE id=?", (acc,)).fetchone()[0]
    if dm or db:
        bad += 1
        print(f"MISMATCH {acc} [{mode}] rows={len(before)} amount_diff={dm} balance_diff={db} worst={worst[0]:.2f}")
print("accounts with differences:", bad)
os.remove(tmp)
