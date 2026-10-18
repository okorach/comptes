import datetime as dt
import os
import unittest

from helpers import make_db
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
