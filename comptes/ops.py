"""Write operations: transactions, deposits, accounts."""
from . import calc


def _f(x):
    if x in (None, ""):
        return None
    return float(str(x).replace(",", ".").replace(" ", ""))


def add_transaction(con, acc, d):
    cur = con.execute(
        "INSERT INTO transactions(account,date,native_amount,native_balance,description,subcategory,in_budget,qty,price)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (acc, d["date"], _f(d.get("native_amount")), _f(d.get("native_balance")), d.get("description"),
         d.get("subcategory") or None, _f(d.get("in_budget")), _f(d.get("qty")), _f(d.get("price"))))
    calc.recompute_account(con, acc)
    con.commit()
    return cur.lastrowid


def update_transaction(con, tid, d):
    row = con.execute("SELECT account FROM transactions WHERE id=?", (tid,)).fetchone()
    if not row:
        return False
    con.execute(
        "UPDATE transactions SET date=?,native_amount=?,native_balance=?,description=?,subcategory=?,"
        "in_budget=?,qty=?,price=? WHERE id=?",
        (d["date"], _f(d.get("native_amount")), _f(d.get("native_balance")), d.get("description"),
         d.get("subcategory") or None, _f(d.get("in_budget")), _f(d.get("qty")), _f(d.get("price")), tid))
    calc.recompute_account(con, row["account"])
    con.commit()
    return True


def delete_transaction(con, tid):
    row = con.execute("SELECT account FROM transactions WHERE id=?", (tid,)).fetchone()
    if not row:
        return False
    con.execute("DELETE FROM transactions WHERE id=?", (tid,))
    calc.recompute_account(con, row["account"])
    con.commit()
    return True


def add_deposit(con, acc, date, native_amount):
    cur = con.execute("SELECT currency FROM accounts WHERE id=?", (acc,)).fetchone()["currency"]
    amt = _f(native_amount)
    eur = amt / calc.Fx(con).rate(cur, date)
    con.execute("INSERT INTO deposits(account,date,amount_eur,native_amount) VALUES(?,?,?,?)", (acc, date, eur, amt))
    con.commit()


def delete_deposit(con, did):
    con.execute("DELETE FROM deposits WHERE id=?", (did,))
    con.commit()


def create_account(con, d):
    mode = d.get("mode") or ("flow" if d.get("type") in (None, "", "Courant") else "snapshot")
    con.execute(
        "INSERT INTO accounts(id,number,bank,availability,status,currency,type,in_budget,tax,website,mode)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (d["id"], d.get("number"), d.get("bank"), int(d.get("availability") or 0), "Open",
         d.get("currency") or "EUR", d.get("type") or "Courant", 1 if d.get("in_budget") else 0,
         _f(d.get("tax")) or 0.0, d.get("website"), mode))
    con.commit()


def set_status(con, acc, status):
    con.execute("UPDATE accounts SET status=? WHERE id=?", (status, acc))
    con.commit()


def add_fx(con, cur, date, rate):
    con.execute("INSERT OR REPLACE INTO fx_rates VALUES(?,?,?)", (cur, date, float(rate)))
    con.commit()
