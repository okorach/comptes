"""Deleting an account: its transactions must have been exported shortly before, and nothing may have changed since"""
import json
import os
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from helpers import make_db
from comptes import ops, server


class DeleteAccountTest(unittest.TestCase):
    def setUp(self):
        self.con, self.path = make_db()
        ops.add_transaction(self.con, "Suisse", {"date": "2024-01-01", "native_amount": "100", "description": "Paie"})
        ops.add_deposit(self.con, "Suisse", "2024-01-02", 50)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.srv.db_path = self.path
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}/api/account/Suisse"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        server.EXPORTED.clear()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.con.close()
        os.remove(self.path)

    def call(self, method, suffix=""):
        req = urllib.request.Request(self.base + suffix, method=method)
        try:
            with urllib.request.urlopen(req) as r:
                body = r.read()
                return json.loads(body) if "json" in r.headers.get("Content-Type", "") else body.decode("utf-8")
        except urllib.error.HTTPError as e:
            return {"HTTP": e.code, **json.loads(e.read())}

    def exists(self):
        return self.con.execute("SELECT COUNT(*) FROM accounts WHERE id='Suisse'").fetchone()[0] == 1

    def test_an_account_is_not_deleted_without_an_export(self):
        res = self.call("DELETE")
        self.assertEqual(res["HTTP"], 400)
        self.assertIn("Exportez d'abord", res["error"])
        self.assertTrue(self.exists())

    def test_an_exported_account_is_deleted_with_everything_it_has(self):
        csv = self.call("GET", "/export.csv")
        self.assertIn("AccountId=Suisse", csv)
        self.assertIn("Mode=flow", csv)                                          # what a restore needs to know about the account
        self.assertIn("2024-01-01,100.0", csv)
        res = self.call("DELETE")
        self.assertEqual(res, {"deleted": {"transactions": 1, "deposits": 1, "interests": 0}})
        self.assertFalse(self.exists())
        for table in ("transactions", "deposits", "interests"):
            self.assertEqual(self.con.execute(f"SELECT COUNT(*) FROM {table} WHERE account='Suisse'").fetchone()[0], 0)
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM accounts WHERE id='Courant'").fetchone()[0], 1)   # the other accounts stay
        self.assertEqual(self.call("DELETE")["HTTP"], 400)                       # gone: unknown account

    def test_an_export_is_good_for_one_deletion_only_and_a_limited_time(self):
        self.call("GET", "/export.csv")
        server.EXPORTED["Suisse"] = (time.time() - server.EXPORT_VALIDITY - 1, *server.EXPORTED["Suisse"][1:])
        self.assertEqual(self.call("DELETE")["HTTP"], 400)                       # too old
        self.assertTrue(self.exists())

    def test_an_account_changed_since_its_export_is_not_deleted(self):
        self.call("GET", "/export.csv")
        ops.add_transaction(self.con, "Suisse", {"date": "2024-02-01", "native_amount": "5"})
        res = self.call("DELETE")
        self.assertEqual(res["HTTP"], 400)
        self.assertIn("a changé depuis son export", res["error"])
        self.assertTrue(self.exists())
        self.call("GET", "/export.csv")                                          # exported again
        self.assertIn("deleted", self.call("DELETE"))


if __name__ == "__main__":
    unittest.main()
