"""Bank file parsers (ports of the BankImport*.bas macros) + duplicate detection."""
import csv, io, re, datetime as dt
from collections import Counter

MONTHS = [("jan", 1), ("fév", 2), ("fev", 2), ("feb", 2), ("mar", 3), ("avr", 4), ("apr", 4), ("mai", 5), ("may", 5),
          ("juin", 6), ("jun", 6), ("juil", 7), ("jul", 7), ("aoû", 8), ("aou", 8), ("aug", 8), ("sep", 9),
          ("oct", 10), ("nov", 11), ("déc", 12), ("dec", 12)]


def to_date(s):
    if isinstance(s, (dt.datetime, dt.date)):
        return (s.date() if isinstance(s, dt.datetime) else s).isoformat()
    s = str(s).strip()
    s = s.split(" ")[0] if re.match(r"^\d{4}-\d\d-\d\d[ T]", s) else s
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    m = re.match(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$", s)
    if m:
        y = int(m[3]); y += 2000 if y < 100 else 0
        return dt.date(y, int(m[2]), int(m[1])).isoformat()
    m = re.match(r"^(\d{1,2}) (\w+)\.? (\d{4})$", s)
    if m:
        low = m[2].lower()
        for k, v in MONTHS:
            if low.startswith(k):
                return dt.date(int(m[3]), v, int(m[1])).isoformat()
    raise ValueError(f"unrecognised date: {s!r}")


def to_amount(x):
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(" ", "").replace(" ", "").replace("'", "").replace("€", "").replace("−", "-")
    if s.endswith("-"):
        s = "-" + s[:-1]
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    return float(s)


# ------------------------------------------------------------- description cleanup
def delete_duplicate_sepa(desc):
    idstr = "PRLV SEPA "
    if desc.startswith(idstr):
        i = desc.find(":")
        if i > 0:
            emitter = desc[len(idstr): i - 1]
            j = desc.find(" DE " + emitter)
            if j > 0:
                return desc[:j]
    return desc


def simplify(desc, subs):
    s = delete_duplicate_sepa(str(desc).strip())
    for pat, rep in subs:
        if pat:
            s = s.replace(pat, rep or "", 1)
    return s


# ------------------------------------------------------------- file -> rows
def decode(b):
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode("latin-1")


def rows_from_upload(filename, data):
    if filename.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return [["" if v is None else v for v in r] for r in wb.worksheets[0].iter_rows(values_only=True)]
    if filename.lower().endswith(".xls"):
        raise ValueError("Format .xls non supporté : enregistrez le fichier en .xlsx ou .csv")
    text = decode(data)
    first = text.splitlines()[0] if text.splitlines() else ""
    delim = ";" if first.count(";") >= first.count(",") else ","
    return list(csv.reader(io.StringIO(text), delimiter=delim))


def _g(r, i):
    return r[i] if i < len(r) and r[i] is not None else ""


def parse(bank, account, filename, data, subs):
    """account: sqlite Row. Returns list of {date, amount, description}."""
    rows = rows_from_upload(filename, data)
    out = []
    cur = account["currency"]
    if bank == "generic":
        return parse_generic(rows)

    def add(date, amount, desc):
        out.append({"date": date, "amount": round(float(amount), 6), "description": desc})

    if bank == "BoursoBank":
        acc = str(account["number"] or "").strip()
        norm = lambda s: str(s).strip().lstrip("0")
        for r in rows[1:]:
            tag = str(_g(r, 8)).strip()
            try:
                if norm(tag) == norm(acc):
                    add(to_date(_g(r, 1)), to_amount(_g(r, 6)), simplify(_g(r, 2), subs))
                elif tag == "Relevé différé Carte " + acc:
                    add(to_date(_g(r, 1)), -to_amount(_g(r, 6)), simplify(_g(r, 2), subs))
            except ValueError:
                continue
    elif bank == "ING":
        for r in rows:
            try:
                add(to_date(_g(r, 0)), to_amount(_g(r, 3)), simplify(_g(r, 1), subs))
            except ValueError:
                continue
    elif bank == "LCL":
        for r in rows:
            try:
                d = to_date(_g(r, 0)); amt = to_amount(_g(r, 1))
            except ValueError:
                continue
            typ = str(_g(r, 2))
            if re.fullmatch(r"Ch.que", typ):
                desc = "Cheque " + simplify(_g(r, 3), subs)
            elif typ == "Virement":
                desc = "Virement " + simplify(_g(r, 4), subs)
            else:
                desc = simplify(f"{typ} {_g(r, 4)} {_g(r, 5)}", subs)
            add(d, amt, desc)
    elif bank == "UBS":
        for r in rows[1:]:
            try:
                d = to_date(_g(r, 11))
            except ValueError:
                continue
            if str(_g(r, 12)) == "Solde prix prestations":
                amt = 0.0
            elif str(_g(r, 17)).strip():
                amt = to_amount(_g(r, 17))
            elif str(_g(r, 18)).strip():
                amt = -to_amount(_g(r, 18))
            elif str(_g(r, 19)).strip():
                amt = to_amount(_g(r, 19))
            else:
                amt = 0.0
            add(d, amt, simplify(f"{_g(r, 12)} {_g(r, 13)} {_g(r, 14)}", subs))
    elif bank == "Revolut":
        for r in rows[1:]:
            try:
                d = to_date(str(_g(r, 2)).split(" ")[0]); amt = to_amount(_g(r, 5))
            except ValueError:
                continue
            desc, comment = str(_g(r, 0)).strip(), str(_g(r, 4)).strip()
            if str(_g(r, 8)).strip() == "REVERTED":
                comment += f" REVERTED: Original amount {amt}"
                amt = 0.0
            else:
                fee = to_amount(_g(r, 6)) if str(_g(r, 6)).strip() else 0.0
                if fee:
                    amt -= fee
                    comment += f" (including fee of {fee} {cur})"
            add(d, amt, simplify(f"{desc} {comment}".strip(), subs))
    elif bank == "Yuh":
        for r in rows[1:]:
            debit, credit = str(_g(r, 3)).strip(), str(_g(r, 5)).strip()
            tcur = str(_g(r, 4) if debit else _g(r, 6)).strip()
            if str(_g(r, 1)) == "REWARD_RECEIVED" or tcur != cur:
                continue
            try:
                d = to_date(_g(r, 0)); amt = to_amount(debit or credit)
            except ValueError:
                continue
            desc = str(_g(r, 2)).strip()
            fee = str(_g(r, 11)).strip()
            if fee and abs(to_amount(fee)) != 0:
                desc += f" (including fee of {abs(to_amount(fee))} {cur})"
            add(d, amt, simplify(desc, subs))
    else:
        raise ValueError(f"Format d'import non reconnu pour la banque « {bank} »")
    return out


def parse_generic(rows):
    meta = {}
    for c in rows[0]:
        if c and "=" in str(c):
            k, v = str(c).split("=", 1); meta[k] = v
    n = int(meta.get("NbrTransactions", len(rows) - 1))
    out = []
    for r in rows[1:1 + n]:
        out.append({"date": to_date(_g(r, 0)), "amount": to_amount(_g(r, 1)),
                    "description": str(_g(r, 3)), "subcategory": str(_g(r, 4)) or None})
    return out


def split_new(con, account_id, parsed):
    existing = Counter((r[0], round(r[1] or 0.0, 2), r[2] or "") for r in con.execute(
        "SELECT date,native_amount,description FROM transactions WHERE account=?", (account_id,)))
    new, dup = [], []
    for p in parsed:
        key = (p["date"], round(p["amount"], 2), p["description"] or "")
        if existing[key] > 0:
            existing[key] -= 1; dup.append(p)
        else:
            new.append(p)
    return new, dup


def commit_new(con, account_id, new):
    for p in new:
        con.execute("INSERT INTO transactions(account,date,native_amount,description,subcategory) VALUES(?,?,?,?,?)",
                    (account_id, p["date"], p["amount"], p["description"], p.get("subcategory")))
    from . import calc
    calc.recompute_account(con, account_id)
    con.commit()
