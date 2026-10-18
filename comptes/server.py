"""Local web server (standard library only).  Run:  python -m comptes.server [port]"""
import base64, csv, io, json, os, re, sys, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from .db import connect, DEFAULT_DB
from . import calc, ops, budget, interest, bankimport

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype, code=200, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _dispatch(self, method):
        u = urlparse(self.path)
        p = unquote(u.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        con = connect(self.server.db_path)
        try:
            if p.startswith("/api/"):
                try:
                    res = self.api(method, p[5:], q, con)
                except (ValueError, KeyError) as e:
                    return self._json({"error": str(e)}, 400)
                except Exception as e:  # sqlite constraint etc.
                    return self._json({"error": f"{type(e).__name__}: {e}"}, 500)
                if isinstance(res, tuple):  # raw (body, ctype, headers)
                    return self._send(res[0], res[1], 200, res[2] if len(res) > 2 else None)
                return self._json(res)
            if method != "GET":
                return self.send_error(405)
            f = os.path.normpath(os.path.join(STATIC, "index.html" if p in ("/", "") else p.lstrip("/")))
            if not f.startswith(STATIC) or not os.path.isfile(f):
                return self.send_error(404)
            with open(f, "rb") as fh:
                data = fh.read()
            self._send(data, (mimetypes.guess_type(f)[0] or "text/plain") + "; charset=utf-8")
        finally:
            con.close()

    do_GET = lambda self: self._dispatch("GET")
    do_POST = lambda self: self._dispatch("POST")
    do_PUT = lambda self: self._dispatch("PUT")
    do_DELETE = lambda self: self._dispatch("DELETE")

    # ------------------------------------------------------------------ API
    def api(self, m, path, q, con):
        parts = path.split("/")
        if path == "accounts":
            if m == "POST":
                d = self._body(); ops.create_account(con, d); return {"ok": True}
            return calc.account_summaries(con)
        if path == "networth":
            return calc.net_worth_series(con, only_open=q.get("open") == "1")
        if path == "meta":
            return {"categories": [dict(r) for r in con.execute("SELECT * FROM categories ORDER BY category,subcategory")],
                    "types": [dict(r) for r in con.execute("SELECT * FROM account_types ORDER BY name")],
                    "currencies": [r[0] for r in con.execute("SELECT DISTINCT currency FROM fx_rates")] + ["EUR"],
                    "banks": [r[0] for r in con.execute("SELECT DISTINCT bank FROM accounts WHERE bank IS NOT NULL ORDER BY 1")]}
        if path == "spending":
            ex = tuple(x for x in q.get("exclude", ",".join(budget.DEFAULT_EXCLUDE)).split(",") if x)
            rep = budget.report(con, q.get("group", "month"), int(q.get("months", 36)), ex)
            rep["all_categories"] = budget.all_categories(con)
            return rep
        if path == "interests":
            rows = con.execute(
                "SELECT i.*, a.tax, a.type, a.status FROM interests i JOIN accounts a ON a.id=i.account ORDER BY a.status DESC, i.account").fetchall()
            return [dict(r) for r in rows]
        if path == "interests/recalc" and m == "POST":
            d = self._body()
            if d.get("account"):
                interest.recalc(con, d["account"]); con.commit(); return {"ok": True, "n": 1}
            return {"ok": True, "n": interest.recalc_all(con, force=bool(d.get("force")))}
        if path == "fx":
            if m == "POST":
                d = self._body(); ops.add_fx(con, d["currency"], d["date"], d["rate"]); return {"ok": True}
            rows = con.execute("SELECT currency,date,rate FROM fx_rates WHERE currency=? ORDER BY date DESC LIMIT 60",
                               (q.get("currency", "CHF"),)).fetchall()
            return [dict(r) for r in rows]
        if parts[0] == "transaction" and len(parts) == 2:
            tid = int(parts[1])
            if m == "PUT": return {"ok": ops.update_transaction(con, tid, self._body())}
            if m == "DELETE": return {"ok": ops.delete_transaction(con, tid)}
        if parts[0] == "deposit" and len(parts) == 2 and m == "DELETE":
            ops.delete_deposit(con, int(parts[1])); return {"ok": True}
        if parts[0] == "account" and len(parts) >= 2:
            acc = parts[1]
            a = con.execute("SELECT * FROM accounts WHERE id=?", (acc,)).fetchone()
            if not a:
                raise ValueError("compte inconnu")
            sub = parts[2] if len(parts) > 2 else ""
            if sub == "":
                if m == "PUT":
                    d = self._body()
                    if "status" in d: ops.set_status(con, acc, d["status"])
                    return {"ok": True}
                dep = con.execute("SELECT * FROM deposits WHERE account=? ORDER BY date DESC", (acc,)).fetchall()
                it = con.execute("SELECT * FROM interests WHERE account=?", (acc,)).fetchone()
                return {"account": dict(a), "deposits": [dict(r) for r in dep], "interests": dict(it) if it else None}
            if sub == "transactions":
                if m == "POST":
                    return {"id": ops.add_transaction(con, acc, self._body())}
                rows = con.execute(
                    "SELECT id,date,amount_eur,balance_eur,native_amount,native_balance,description,subcategory,in_budget,qty,price "
                    "FROM transactions WHERE account=? ORDER BY date DESC, id DESC LIMIT ?",
                    (acc, int(q.get("limit", 500)))).fetchall()
                return [dict(r) for r in rows]
            if sub == "deposits" and m == "POST":
                d = self._body(); ops.add_deposit(con, acc, d["date"], d["amount"]); return {"ok": True}
            if sub == "import" and m == "POST":
                d = self._body()
                subs = [(r[0], r[1]) for r in con.execute("SELECT pattern,replacement FROM substitutions ORDER BY id")]
                bank = d.get("bank") or a["bank"]
                parsed = bankimport.parse(bank, a, d["filename"], base64.b64decode(d["data"]), subs)
                new, dup = bankimport.split_new(con, acc, parsed)
                if d.get("commit"):
                    bankimport.commit_new(con, acc, new)
                return {"new": new, "duplicates": len(dup), "committed": bool(d.get("commit"))}
            if sub == "export.csv":
                return self.export_csv(con, a)
        raise ValueError("route inconnue: " + path)

    def export_csv(self, con, a):
        acc = a["id"]
        tr = con.execute("SELECT date,native_amount,native_balance,description,subcategory FROM transactions "
                         "WHERE account=? ORDER BY date,id", (acc,)).fetchall()
        dep = con.execute("SELECT date,native_amount FROM deposits WHERE account=? ORDER BY date", (acc,)).fetchall()
        buf = io.StringIO(); w = csv.writer(buf, lineterminator="\n")
        meta = [f"ExportDate={__import__('datetime').datetime.now():%Y-%m-%d %H:%M:%S}", f"AccountId={acc}",
                f"AccountNumber={a['number'] or ''}", f"Bank={a['bank'] or ''}", f"Availability={a['availability']}",
                f"Currency={a['currency']}", f"Type={a['type']}", f"TaxRate={a['tax']}", f"NbrTransactions={len(tr)}"]
        if dep: meta.append(f"NbrDeposits={len(dep)}")
        w.writerow(meta)
        for r in tr: w.writerow([r[0], r[1], r[2], r[3], r[4]])
        for r in dep: w.writerow([r[0], r[1]])
        name = re.sub(r"[^\w.-]+", "_", acc) + ".csv"
        return (buf.getvalue().encode("utf-8"), "text/csv; charset=utf-8",
                {"Content-Disposition": f'attachment; filename="{name}"'})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    db = os.environ.get("COMPTES_DB", DEFAULT_DB)
    if not os.path.exists(db):
        sys.exit(f"Database not found: {db}\nRun first: python -m comptes.import_xlsx <path to Comptes.xlsm>")
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.db_path = db
    print(f"Comptes running on http://localhost:{port}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
