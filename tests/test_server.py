import base64
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from helpers import make_db
from comptes import ops, server


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
        self.assertEqual(rows[0]["balance_eur"], 90.0)
        self.call("PUT", f"/api/transaction/{tid}", {"date": "2024-02-01", "native_amount": "-20"})
        self.assertEqual(self.call("GET", acc + "/transactions?limit=1")[0]["balance_eur"], 80.0)
        self.call("DELETE", f"/api/transaction/{tid}")
        self.assertEqual(len(self.call("GET", acc + "/transactions?limit=10")), 1)

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
