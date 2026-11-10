"""Search across the transactions of all the accounts: free text, category, date range and amount range, combined (all must match)"""
import datetime as dt
import sqlite3
import unicodedata

MAX_ROWS = 2000
DEFAULT_ROWS = 500
CENT = 0.005  # amounts are stored as floats: bounds are widened by half a cent so that "12.50" finds 12.4999999
AMOUNTS = ("t.amount_main", "t.native_amount", "t.fx_amount")  # the amount may be remembered in any of the currencies


def fold(text: str | None) -> str:
    """Lower case without accents, to search regardless of both"""
    return unicodedata.normalize("NFD", text or "").encode("ascii", "ignore").decode().lower()


def _date(q: dict, key: str, label: str) -> str | None:
    """ISO date of the criterion, None when empty, ValueError when it is not a date"""
    value = (q.get(key) or "").strip()
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError as e:
        raise ValueError(f"{label} invalide : {value}") from e


def _amount(q: dict, key: str, label: str) -> float | None:
    """Absolute value of the amount of the criterion (comma or point as decimal separator), None when empty, ValueError when invalid"""
    value = (q.get(key) or "").strip().replace(" ", "").replace(",", ".")
    if not value:
        return None
    try:
        return abs(float(value))
    except ValueError as e:
        raise ValueError(f"{label} invalide : {value}") from e


def _limit(q: dict) -> int:
    """Number of rows wanted, between 1 and MAX_ROWS"""
    try:
        return max(1, min(int(q.get("limit") or DEFAULT_ROWS), MAX_ROWS))
    except ValueError as e:
        raise ValueError("limite invalide") from e


def _amount_conditions(q: dict) -> tuple[str, list] | None:
    """Clause and parameters for the amount range. It is on the absolute value (50 finds an expense of 50 as well as an income of 50),
    and satisfied when any of the amounts of the transaction is in the range"""
    low, high = _amount(q, "amount_min", "Montant minimum"), _amount(q, "amount_max", "Montant maximum")
    if low is None and high is None:
        return None
    if low is not None and high is not None and low > high:
        low, high = high, low
    tests, values = [], []
    if low is not None:
        tests.append("ABS({col})>=?")
        values.append(low - CENT)
    if high is not None:
        tests.append("ABS({col})<=?")
        values.append(high + CENT)
    one = "(" + " AND ".join(tests) + ")"
    return "(" + " OR ".join(one.format(col=col) for col in AMOUNTS) + ")", values * len(AMOUNTS)


def _conditions(q: dict) -> tuple[list[str], list]:
    """WHERE clauses (all to be satisfied) and their parameters for the criteria of the search"""
    where: list[str] = []
    args: list = []
    for key, clause in (("account", "t.account=?"), ("category", "c.category=?"), ("subcategory", "t.subcategory=?")):
        if q.get(key):
            where.append(clause)
            args.append(q[key])
    start, end = _date(q, "date_from", "Date de début"), _date(q, "date_to", "Date de fin")
    if start:
        where.append("substr(t.date,1,10)>=?")
        args.append(start)
    if end:
        where.append("substr(t.date,1,10)<=?")
        args.append(end)
    amounts = _amount_conditions(q)
    if amounts:
        where.append(amounts[0])
        args.extend(amounts[1])
    for word in fold(q.get("text")).split():
        where.append("instr(fold(coalesce(t.description,'') || ' ' || coalesce(t.subcategory,'')),?)>0")
        args.append(word)
    return where, args


def run(con: sqlite3.Connection, q: dict) -> dict:
    """{rows, total, truncated}: the most recent transactions matching the criteria in q (strings, all optional):
    text (every word must be in the description or the sub-category), account, category, subcategory,
    date_from, date_to (ISO dates, included), amount_min, amount_max (absolute value, in the master currency, in the currency
    of the account or in the original currency of the transaction), limit."""
    limit = _limit(q)
    where, args = _conditions(q)
    con.create_function("fold", 1, fold, deterministic=True)
    source = "FROM transactions t JOIN accounts a ON a.id=t.account LEFT JOIN categories c ON c.subcategory=t.subcategory"
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = con.execute(f"SELECT COUNT(*) {source}{clause}", args).fetchone()[0]
    rows = con.execute(
        "SELECT t.id,t.account,t.date,t.amount_main,t.native_amount,a.currency,t.fx_currency,t.fx_amount,t.description,t.subcategory,c.category "
        f"{source}{clause} ORDER BY t.date DESC, t.id DESC LIMIT ?", [*args, limit]).fetchall()
    return {"rows": [dict(r) for r in rows], "total": total, "truncated": total > len(rows)}


def rank_in_account(con: sqlite3.Connection, account: str, tid: int) -> int:
    """Position of the transaction in the list of its account, the most recent first (1 = the latest): how many rows to load to reach it"""
    row = con.execute("SELECT date FROM transactions WHERE id=? AND account=?", (tid, account)).fetchone()
    if not row:
        return 0
    return con.execute("SELECT COUNT(*) FROM transactions WHERE account=? AND (date>? OR (date=? AND id>=?))",
                       (account, row[0], row[0], tid)).fetchone()[0]
