import datetime as dt
import os
import unittest

from helpers import make_db
from comptes import calc, ops


class CalcTest(unittest.TestCase):
    def setUp(self):
        self.con, self.path = make_db()

    def tearDown(self):
        self.con.close()
        os.remove(self.path)

    def test_flow_running_balance(self):
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-01", "native_amount": "1000"})
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-05", "native_amount": "-12,50"})
        rows = self.con.execute("SELECT balance_eur FROM transactions ORDER BY date").fetchall()
        self.assertEqual([r[0] for r in rows], [1000.0, 987.5])

    def test_fx_approximate_match(self):
        fx = calc.Fx(self.con)
        self.assertEqual(fx.rate("EUR", "2024-01-01"), 1.0)
        self.assertEqual(fx.rate("CHF", "2020-06-01"), 1.0)
        self.assertEqual(fx.rate("CHF", "2022-01-01"), 2.0)
        self.assertEqual(fx.rate("CHF", "2019-01-01"), 1.0)  # before the first rate
        with self.assertRaises(ValueError):
            fx.rate("USD", "2022-01-01")

    def test_foreign_currency_conversion(self):
        ops.add_transaction(self.con, "Suisse", {"date": "2022-01-01", "native_amount": "200"})
        row = self.con.execute("SELECT amount_eur,balance_eur,native_balance FROM transactions").fetchone()
        self.assertEqual((row[0], row[1], row[2]), (100.0, 100.0, 200.0))

    def test_snapshot_amount_is_delta(self):
        ops.add_transaction(self.con, "Epargne", {"date": "2024-01-01", "native_balance": "100"})
        ops.add_transaction(self.con, "Epargne", {"date": "2024-02-01", "native_balance": "130"})
        rows = self.con.execute("SELECT amount_eur,balance_eur FROM transactions ORDER BY date").fetchall()
        self.assertEqual([tuple(r) for r in rows], [(100.0, 100.0), (30.0, 130.0)])

    def test_shares_quantity_times_price(self):
        ops.add_transaction(self.con, "Actions", {"date": "2024-01-01", "qty": "10", "price": "5,5"})
        self.assertEqual(self.con.execute("SELECT balance_eur FROM transactions").fetchone()[0], 55.0)

    def test_update_and_delete(self):
        tid = ops.add_transaction(self.con, "Courant", {"date": "2024-01-01", "native_amount": "10"})
        self.assertTrue(ops.update_transaction(self.con, tid, {"date": "2024-01-02", "native_amount": "20"}))
        self.assertEqual(self.con.execute("SELECT balance_eur FROM transactions").fetchone()[0], 20.0)
        self.assertTrue(ops.delete_transaction(self.con, tid))
        self.assertFalse(ops.delete_transaction(self.con, tid))
        self.assertFalse(ops.update_transaction(self.con, tid, {"date": "2024-01-02"}))

    def test_summaries_and_net_worth(self):
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-10", "native_amount": "500"})
        ops.add_transaction(self.con, "Suisse", {"date": "2024-01-20", "native_amount": "200"})
        summ = {s["id"]: s for s in calc.account_summaries(self.con, "2024-12-31")}
        self.assertEqual(summ["Courant"]["balance_eur"], 500.0)
        self.assertEqual(summ["Suisse"]["balance_eur"], 100.0)
        self.assertEqual(summ["Epargne"]["balance_eur"], 0.0)
        series = calc.net_worth_series(self.con, "2024-01-01", only_open=True)
        self.assertEqual(series[0], {"month": "2024-01", "total": 600.0})
        self.assertEqual(series[-1]["month"], dt.date.today().strftime("%Y-%m"))
        self.assertEqual(series[-1]["total"], 600.0)

    def test_account_admin(self):
        ops.create_account(self.con, {"id": "Nouveau", "type": "Livret", "currency": "CHF", "in_budget": True})
        row = self.con.execute("SELECT mode,status,in_budget FROM accounts WHERE id='Nouveau'").fetchone()
        self.assertEqual(tuple(row), ("snapshot", "Open", 1))
        ops.set_status(self.con, "Nouveau", "Closed")
        self.assertEqual(self.con.execute("SELECT status FROM accounts WHERE id='Nouveau'").fetchone()[0], "Closed")
        ops.add_fx(self.con, "USD", "2024-01-01", "1.1")
        self.assertEqual(calc.Fx(self.con).rate("USD", "2024-06-01"), 1.1)

    def test_deposits(self):
        ops.add_deposit(self.con, "Suisse", "2022-01-01", "200")
        dep = self.con.execute("SELECT id,amount_eur,native_amount FROM deposits").fetchone()
        self.assertEqual((dep[1], dep[2]), (100.0, 200.0))
        ops.delete_deposit(self.con, dep[0])
        self.assertIsNone(self.con.execute("SELECT id FROM deposits").fetchone())


if __name__ == "__main__":
    unittest.main()
