"""Write operations: transactions, deposits, accounts."""
import sqlite3

from . import calc, interest


def _f(x):
    if x in (None, ""):
        return None
    return float(str(x).replace(",", ".").replace(" ", ""))


def _original_amount(con: sqlite3.Connection, acc: str, d: dict) -> tuple[str | None, float | None, int]:
    """(fx_currency, fx_amount, fx_auto) of a transaction made in a currency other than the one of the account.
    Only flow / static accounts take them; without an entered amount in the currency of the account, it is converted."""
    cur = (d.get("fx_currency") or "").strip().upper() or None
    amt = _f(d.get("fx_amount"))
    if cur is None and amt is None:
        return None, None, 0
    if cur is None or amt is None:
        raise ValueError("devise et montant d'origine vont ensemble")
    a = con.execute("SELECT currency,mode FROM accounts WHERE id=?", (acc,)).fetchone()
    if a["mode"] not in ("flow", "static"):
        raise ValueError("montant dans une autre devise impossible sur ce type de compte")
    if cur == a["currency"]:
        raise ValueError("la devise d'origine doit être différente de celle du compte")
    auto = _f(d.get("native_amount")) is None
    if auto:
        calc.Fx(con).rate(cur, d["date"])  # fails early when there is no exchange rate
    return cur, amt, int(auto)


def add_transaction(con, acc, d):
    fx_cur, fx_amt, fx_auto = _original_amount(con, acc, d)
    cur = con.execute(
        "INSERT INTO transactions(account,date,native_amount,native_balance,description,subcategory,in_budget,qty,price,"
        "fx_currency,fx_amount,fx_auto) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (acc, d["date"], _f(d.get("native_amount")), _f(d.get("native_balance")), d.get("description"),
         d.get("subcategory") or None, _f(d.get("in_budget")), _f(d.get("qty")), _f(d.get("price")), fx_cur, fx_amt, fx_auto))
    calc.recompute_account(con, acc)
    con.commit()
    return cur.lastrowid


def update_transaction(con, tid, d):
    row = con.execute("SELECT account FROM transactions WHERE id=?", (tid,)).fetchone()
    if not row:
        return False
    fx_cur, fx_amt, fx_auto = _original_amount(con, row["account"], d)
    con.execute(
        "UPDATE transactions SET date=?,native_amount=?,native_balance=?,description=?,subcategory=?,"
        "in_budget=?,qty=?,price=?,fx_currency=?,fx_amount=?,fx_auto=? WHERE id=?",
        (d["date"], _f(d.get("native_amount")), _f(d.get("native_balance")), d.get("description"),
         d.get("subcategory") or None, _f(d.get("in_budget")), _f(d.get("qty")), _f(d.get("price")), fx_cur, fx_amt, fx_auto, tid))
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
    main = amt / calc.Fx(con).rate(cur, date)
    con.execute("INSERT INTO deposits(account,date,amount_main,native_amount) VALUES(?,?,?,?)", (acc, date, main, amt))
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
         d.get("currency") or calc.master_currency(con), d.get("type") or "Courant", 1 if d.get("in_budget") else 0,
         _f(d.get("tax")) or 0.0, d.get("website"), mode))
    con.commit()


def set_status(con: sqlite3.Connection, acc: str, status: str) -> None:
    """Opens or closes an account. An account can only be closed when its balance is zero (ValueError otherwise)."""
    if status == "Closed":
        last = con.execute("SELECT t.balance_main, t.native_balance, a.currency FROM transactions t JOIN accounts a ON a.id=t.account "
                           "WHERE t.account=? AND t.date<=? ORDER BY t.date DESC, t.id DESC LIMIT 1", (acc, calc.today_iso())).fetchone()
        if last and any(abs(v) >= 0.005 for v in (last["balance_main"] or 0, last["native_balance"] or 0)):
            balance = (last["native_balance"] if last["native_balance"] else last["balance_main"]) or 0
            raise ValueError(f"Impossible de clôturer {acc} : son solde n'est pas nul ({balance:.2f} {last['currency']})".replace(".", ","))
    con.execute("UPDATE accounts SET status=? WHERE id=?", (status, acc))
    con.commit()


def add_fx(con, cur, date, rate):
    con.execute("INSERT OR REPLACE INTO fx_rates VALUES(?,?,?)", (cur, date, float(rate)))
    con.commit()


def recompute_everything(con: sqlite3.Connection) -> None:
    """Recomputes, with the current exchange rates and master currency, the balances of all accounts, the deposits and the yields.
    The caller commits."""
    fx = calc.Fx(con)
    for (acc,) in con.execute("SELECT id FROM accounts").fetchall():
        calc.recompute_account(con, acc, fx)
    for d in con.execute("SELECT d.id,d.date,d.native_amount,a.currency FROM deposits d JOIN accounts a ON a.id=d.account").fetchall():
        if d["native_amount"] is not None:
            con.execute("UPDATE deposits SET amount_main=? WHERE id=?", (d["native_amount"] / fx.rate(d["currency"], d["date"]), d["id"]))
    interest.recalc_all(con, force=True)


def set_master_currency(con: sqlite3.Connection, currency: str) -> None:
    """Changes the currency of the application: every amount, balance and yield expressed in it is recomputed.
    EUR, or a currency with exchange rates, is required."""
    cur = (currency or "").strip().upper()
    if len(cur) != 3 or not cur.isalpha():
        raise ValueError("devise invalide")
    try:
        # deposits imported without an amount in the currency of their account: keep it, expressed with the current master currency
        old_fx = calc.Fx(con)
        for d in con.execute("SELECT d.id,d.date,d.amount_main,a.currency FROM deposits d JOIN accounts a ON a.id=d.account "
                             "WHERE d.native_amount IS NULL AND d.amount_main IS NOT NULL").fetchall():
            con.execute("UPDATE deposits SET native_amount=? WHERE id=?", (d["amount_main"] * old_fx.rate(d["currency"], d["date"]), d["id"]))
        con.execute("INSERT OR REPLACE INTO params VALUES('master_currency',?)", (cur,))
        calc.Fx(con).per_eur(cur, calc.today_iso())  # fails when there is no exchange rate for this currency
        recompute_everything(con)
    except Exception:
        con.rollback()
        raise
    con.commit()
