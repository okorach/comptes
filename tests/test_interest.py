import datetime as dt
import os
import sqlite3
import tempfile
import unittest

from helpers import make_db
from comptes.db import connect
from comptes import calc, interest, ops


class InterestTest(unittest.TestCase):
    def test_one_year_ten_percent(self):
        start, end = dt.datetime(2023, 1, 1), dt.datetime(2024, 1, 1)
        rate = interest.rate_for_period([("2023-01-01", 1000.0), ("2024-01-01", 1100.0)], [], start, end, 1)
        self.assertAlmostEqual(rate, 0.10, places=4)

    def test_deposit_is_taken_into_account(self):
        start, end = dt.datetime(2023, 1, 1), dt.datetime(2024, 1, 1)
        bal = [("2023-01-01", 0.0), ("2024-01-01", 1100.0)]
        rate = interest.rate_for_period(bal, [("2023-01-02", 1000.0)], start, end, 1)
        self.assertAlmostEqual(rate, 0.10, places=2)

    def test_degenerate_inputs(self):
        d = dt.datetime(2024, 1, 1)
        self.assertIsNone(interest.rate_for_period([], [], d, d + dt.timedelta(days=5), 1))
        self.assertIsNone(interest.rate_for_period([("2024-01-01", 1.0)], [], d, d, 1))
        self.assertIsNone(interest.rate_for_period([("2025-01-01", 1.0)], [], d, d + dt.timedelta(days=5), 1))

    def test_has_interests(self):
        self.assertFalse(interest.has_interests("Courant"))
        self.assertFalse(interest.has_interests(None))
        self.assertTrue(interest.has_interests("PEA"))

    def test_recalc_stores_net_rates(self):
        con, path = make_db()
        try:
            ops.add_transaction(con, "Epargne", {"date": "2023-01-01", "native_balance": "1000"})
            ops.add_transaction(con, "Epargne", {"date": "2024-01-01", "native_balance": "1100"})
            ops.add_deposit(con, "Epargne", "2023-01-01", "1000")
            now = dt.datetime(2024, 1, 1)
            gross, _ = interest.key_interests(con, "Epargne", now)
            self.assertIsNotNone(gross["y_all"])
            net = interest.recalc(con, "Epargne", now)
            self.assertAlmostEqual(net["y_all"], gross["y_all"] * 0.7)
            con.commit()
            row = con.execute("SELECT y_all FROM interests WHERE account='Epargne'").fetchone()
            self.assertAlmostEqual(row[0], net["y_all"])
            # Livret is a yearly type (skipped unless forced); PEA is always computed
            self.assertEqual(interest.recalc_all(con, now=now), 1)
            self.assertEqual(interest.recalc_all(con, force=True, now=now), 2)
        finally:
            con.close()
            os.remove(path)

    def test_no_deposits_gives_no_rates(self):
        con, path = make_db()
        try:
            rates, _ = interest.key_interests(con, "Courant")
            self.assertTrue(all(v is None for v in rates.values()))
            self.assertEqual(calc.today_iso(), dt.date.today().isoformat())
        finally:
            con.close()
            os.remove(path)


if __name__ == "__main__":
    unittest.main()


class NativeInterestTest(unittest.TestCase):
    """Accounts that are not in EUR also get the yield in their own currency, without the exchange rate effect"""

    @staticmethod
    def _chf_account(con):
        # 1000 CHF -> 1100 CHF in one year (+10%), but the CHF doubled against the EUR: 500 EUR -> 1100 EUR
        con.executemany("INSERT INTO transactions(account,date,amount_main,balance_main,native_amount,native_balance) VALUES('Suisse',?,?,?,?,?)",
                        [("2023-01-01", 500.0, 500.0, 1000.0, 1000.0), ("2024-01-01", 0.0, 1100.0, 0.0, 1100.0)])
        con.execute("INSERT INTO deposits(account,date,amount_main,native_amount) VALUES('Suisse','2023-01-01',500.0,1000.0)")
        con.commit()

    def test_native_rate_ignores_the_exchange_rate(self):
        con, path = make_db()
        try:
            self._chf_account(con)
            now = dt.datetime(2024, 1, 1)
            eur, _ = interest.key_interests(con, "Suisse", now)
            own, _ = interest.key_interests(con, "Suisse", now, native=True)
            self.assertAlmostEqual(own["y_all"], 0.10, places=3)
            self.assertAlmostEqual(eur["y_all"], 1.20, places=2)
        finally:
            con.close()
            os.remove(path)

    def test_recalc_stores_native_rates_for_foreign_accounts_only(self):
        con, path = make_db()
        try:
            self._chf_account(con)
            interest.recalc(con, "Suisse", dt.datetime(2024, 1, 1))
            row = con.execute("SELECT y_all, n_all, n1 FROM interests WHERE account='Suisse'").fetchone()
            self.assertAlmostEqual(row["n_all"], 0.10, places=3)
            self.assertAlmostEqual(row["y_all"], 1.20, places=2)
            self.assertIsNotNone(row["n1"])
            ops.add_transaction(con, "Epargne", {"date": "2023-01-01", "native_balance": "1000"})
            ops.add_transaction(con, "Epargne", {"date": "2024-01-01", "native_balance": "1100"})
            ops.add_deposit(con, "Epargne", "2023-01-01", "1000")
            interest.recalc(con, "Epargne", dt.datetime(2024, 1, 1))
            eur_row = con.execute("SELECT y_all, n_all FROM interests WHERE account='Epargne'").fetchone()
            self.assertIsNotNone(eur_row["y_all"])
            self.assertIsNone(eur_row["n_all"])
        finally:
            con.close()
            os.remove(path)

    def test_existing_database_gets_the_native_columns(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            old = sqlite3.connect(path)
            old.execute("CREATE TABLE interests(account TEXT PRIMARY KEY, calc_date TEXT, y1 REAL, y3 REAL, y5 REAL, y8 REAL, y_all REAL)")
            old.commit()
            old.close()
            con = connect(path)
            cols = {r[1] for r in con.execute("PRAGMA table_info(interests)")}
            con.close()
            self.assertLessEqual({"n1", "n3", "n5", "n8", "n_all"}, cols)
        finally:
            os.remove(path)

    def test_native_rate_of_a_shares_account_uses_quantity_times_price(self):
        con, path = make_db()
        try:
            con.execute("UPDATE accounts SET currency='USD', mode='shares' WHERE id='Actions'")
            con.executemany("INSERT INTO transactions(account,date,balance_main,qty,price) VALUES('Actions',?,?,?,?)",
                            [("2023-01-01", 500.0, 10.0, 100.0), ("2024-01-01", 1100.0, 10.0, 110.0)])
            con.execute("INSERT INTO deposits(account,date,amount_main,native_amount) VALUES('Actions','2023-01-01',500.0,1000.0)")
            own, _ = interest.key_interests(con, "Actions", dt.datetime(2024, 1, 1), native=True)
            self.assertAlmostEqual(own["y_all"], 0.10, places=3)
        finally:
            con.close()
            os.remove(path)
