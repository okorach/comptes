import base64
import datetime as dt
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from helpers import make_db
from comptes import ops, rates, server


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.con, cls.path = make_db()
        ops.add_transaction(cls.con, "Courant", {"date": "2024-01-01", "native_amount": "100", "subcategory": "Courses"})
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.srv.db_path = cls.path
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.con.close()
        os.remove(cls.path)

    def call(self, method, path, data=None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"HTTP": e.code}

    def test_read_endpoints(self):
        self.assertEqual(len(self.call("GET", "/api/accounts")), 4)
        self.assertTrue(self.call("GET", "/api/networth"))
        self.assertIn("currencies", self.call("GET", "/api/meta"))
        self.assertIn("series", self.call("GET", "/api/spending?group=month&months=12"))
        self.assertIsInstance(self.call("GET", "/api/interests"), list)
        self.assertEqual(self.call("GET", "/api/fx?currency=CHF")[0]["currency"] if
                         isinstance(self.call("GET", "/api/fx?currency=CHF")[0], dict) else "CHF", "CHF")

    def test_transaction_lifecycle(self):
        acc = "/api/account/Courant"
        tid = self.call("POST", acc + "/transactions", {"date": "2024-02-01", "native_amount": "-10", "description": "T"})["id"]
        rows = self.call("GET", acc + "/transactions?limit=10")
        self.assertEqual(rows[0]["balance_main"], 90.0)
        self.call("PUT", f"/api/transaction/{tid}", {"date": "2024-02-01", "native_amount": "-20"})
        self.assertEqual(self.call("GET", acc + "/transactions?limit=1")[0]["balance_main"], 80.0)
        self.call("DELETE", f"/api/transaction/{tid}")
        self.assertEqual(len(self.call("GET", acc + "/transactions?limit=10")), 1)

    def test_transaction_in_another_currency(self):
        acc = "/api/account/Suisse"
        self.call("POST", "/api/fx", {"currency": "USD", "date": "2020-01-01", "rate": 1.25})
        self.call("POST", acc + "/transactions", {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-100", "description": "US"})
        row = next(r for r in self.call("GET", acc + "/transactions?limit=50") if r["date"] == "2022-02-01")
        self.assertEqual((row["fx_currency"], row["fx_amount"], row["fx_auto"]), ("USD", -100.0, 1))
        self.assertAlmostEqual(row["native_amount"], -160.0)
        self.assertAlmostEqual(row["native_balance"], -160.0)
        self.assertEqual(self.call("POST", acc + "/transactions", {"date": "2022-02-01", "fx_currency": "USD"})["HTTP"], 400)

    def test_csv_export_includes_the_original_amount(self):
        acc = "/api/account/Suisse"
        self.call("POST", "/api/fx", {"currency": "USD", "date": "2020-01-01", "rate": 1.25})
        self.call("POST", acc + "/transactions", {"date": "2030-03-01", "native_amount": "1000", "description": "CHF"})
        self.call("POST", acc + "/transactions", {"date": "2030-03-02", "fx_currency": "USD", "fx_amount": "-100", "description": "US"})
        with urllib.request.urlopen(self.base + acc + "/export.csv") as r:
            lines = r.read().decode("utf-8").splitlines()
        # date, amount in CHF, balance (depends on the other tests), description, subcategory, original currency, original amount
        rows = [line.split(",") for line in lines[1:] if "2030-03" in line]
        self.assertEqual([r[:2] + r[3:] for r in rows], [["2030-03-01", "1000.0", "CHF", "", "", ""], ["2030-03-02", "-160.0", "US", "", "USD", "-100.0"]])

    def test_master_currency(self):
        self.assertEqual(self.call("GET", "/api/meta")["master_currency"], "EUR")
        self.assertEqual(self.call("POST", "/api/master_currency", {"currency": "JPY"})["HTTP"], 400)  # no exchange rate
        self.assertEqual(self.call("POST", "/api/master_currency", {"currency": "CHF"}), {"ok": True})
        try:
            self.assertEqual(self.call("GET", "/api/meta")["master_currency"], "CHF")
        finally:
            self.call("POST", "/api/master_currency", {"currency": "EUR"})
        self.assertEqual(self.call("GET", "/api/meta")["master_currency"], "EUR")

    def test_refresh_of_the_exchange_rates(self):
        with mock.patch.object(rates, "fetch_rates", return_value={"2030-01-07": 1.5}) as fetched:  # never the real internet
            res = self.call("POST", "/api/fx/refresh")
        self.assertEqual((res["offline"], res["errors"]), (False, []))
        self.assertIn("taux de change", res["message"].lower())
        self.assertEqual(res["added"], sum(res["currencies"].values()))
        self.assertEqual(fetched.call_count, len(res["currencies"]) + len(res["errors"]))

    def test_refresh_when_offline(self):
        with mock.patch.object(rates, "fetch_rates", side_effect=OSError("no network")):
            res = self.call("POST", "/api/fx/refresh")
        self.assertIn(res["offline"], (True, False))  # offline only if there is something to retrieve
        self.assertEqual(res["added"], 0)

    def test_search_finds_a_transaction_of_any_account(self):
        tid = self.call("POST", "/api/account/Suisse/transactions", {"date": "2031-05-05", "native_amount": "77", "description": "Zorglub"})["id"]
        res = self.call("GET", "/api/search?text=zorglub&amount_min=77&date_from=2031-01-01")
        self.assertEqual((res["total"], res["truncated"], [r["account"] for r in res["rows"]]), (1, False, ["Suisse"]))
        self.assertEqual(self.call("GET", "/api/search?text=zorglub&amount_min=1000")["rows"], [])
        self.assertEqual(self.call("GET", "/api/search?date_from=hier")["HTTP"], 400)
        self.call("DELETE", f"/api/transaction/{tid}")

    def test_account_transactions_are_all_returned_unless_a_limit_is_asked(self):
        acc = "/api/account/Courant"
        before = len(self.call("GET", acc + "/transactions"))
        self.con.executemany("INSERT INTO transactions(account,date,native_amount,description) VALUES('Courant',?,0,'bulk')",
                             [(f"1990-01-{1 + i % 28:02d}",) for i in range(600)])   # more than the old limit of 500
        self.con.commit()
        try:
            self.assertEqual(len(self.call("GET", acc + "/transactions")), before + 600)
            self.assertEqual(len(self.call("GET", acc + "/transactions?limit=10")), 10)
            self.assertEqual(self.call("GET", acc + "/transactions")[-1]["description"], "bulk")   # the oldest ones are there too
        finally:
            self.con.execute("DELETE FROM transactions WHERE description='bulk'")
            self.con.commit()

    def test_the_yields_are_recomputed_when_the_page_asks_for_them(self):
        self.con.execute("INSERT OR REPLACE INTO interests(account,calc_date) VALUES('Epargne','2000-01-01T00:00:00')")
        self.con.commit()
        rows = {r["account"]: r for r in self.call("GET", "/api/interests")}
        self.assertTrue(rows["Epargne"]["calc_date"].startswith(dt.date.today().isoformat()))
        self.assertTrue(all(r["calc_date"].startswith(dt.date.today().isoformat()) for r in rows.values() if r["status"] == "Open"))
        self.con.execute("DELETE FROM interests")
        self.con.commit()

    def test_interests_tell_the_date_of_the_last_transaction_of_the_account(self):
        self.con.execute("INSERT OR REPLACE INTO interests(account) VALUES('Courant')")
        self.con.commit()
        rows = {r["account"]: r for r in self.call("GET", "/api/interests")}
        last = self.con.execute("SELECT MAX(date) FROM transactions WHERE account='Courant' AND date<=date('now')").fetchone()[0]
        self.assertEqual(rows["Courant"]["last_date"], last)
        self.con.execute("DELETE FROM interests WHERE account='Courant'")
        self.con.commit()

    def test_import_preview(self):
        csv = "d;a;b;c\n2024-03-01;x;SHOP;-3,10\n".encode()
        res = self.call("POST", "/api/account/Courant/import",
                        {"filename": "a.csv", "bank": "generic", "data": base64.b64encode(csv).decode()})
        self.assertIsInstance(res, dict)

    def test_static_and_unknown(self):
        with urllib.request.urlopen(self.base + "/") as r:
            self.assertIn(b"<html", r.read().lower())
        self.assertIn(self.call("GET", "/api/nope")["HTTP"], (400, 404))


if __name__ == "__main__":
    unittest.main()
