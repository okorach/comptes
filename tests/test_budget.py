import datetime as dt
import os
import unittest

from helpers import make_db
from comptes import budget, ops


class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.con, self.path = make_db()
        add = lambda d, a, sub, b=None: ops.add_transaction(
            self.con, "Courant", {"date": d, "native_amount": a, "subcategory": sub, "in_budget": b})
        add("2024-01-01", "2000", "Paie")
        add("2024-01-10", "-100", "Courses")
        add("2024-01-15", "-300", "Loisirs", "3")   # spread over 3 months
        add("2024-01-20", "-50", "Courses", "0")    # excluded
        ops.add_transaction(self.con, "Epargne", {"date": "2024-01-10", "native_balance": "999"})  # not in budget

    def tearDown(self):
        self.con.close()
        os.remove(self.path)

    def test_spread_rows(self):
        rows = list(budget.spread_rows(self.con, "2024-12-31"))
        spreads = [r for r in rows if r[3] == "Loisirs"]
        self.assertEqual([r[0] for r in spreads], ["2024-01-15", "2024-02-01", "2024-03-01"])
        self.assertAlmostEqual(sum(r[4] for r in spreads), 300.0)
        self.assertAlmostEqual(sum(r[5] for r in spreads), 300.0)  # raw only on the original row
        self.assertFalse([r for r in rows if r[5] == 50.0])
        self.assertEqual(len(list(budget.spread_rows(self.con, "2024-02-15"))), 4)

    def test_report_groups(self):
        today = dt.date(2024, 3, 31)
        month = budget.report(self.con, "month", 3, today=today)
        by = {s["period"]: s for s in month["series"]}
        self.assertAlmostEqual(by["2024-01"]["spread"], 200.0)  # 100 + 300/3, Salaire excluded
        self.assertAlmostEqual(by["2024-02"]["spread"], 100.0)
        quarter = budget.report(self.con, "quarter", 3, today=today)
        self.assertEqual([s["period"] for s in quarter["series"]], ["2024-T1"])
        year = budget.report(self.con, "year", 3, today=today)
        self.assertEqual([s["period"] for s in year["series"]], ["2024"])
        self.assertAlmostEqual(year["series"][0]["spread"], 400.0)

    def test_report_include_everything(self):
        rep = budget.report(self.con, "year", 3, exclude=(), today=dt.date(2024, 3, 31))
        self.assertAlmostEqual(rep["series"][0]["spread"], 400.0 - 2000.0)

    def test_categories(self):
        self.assertIn("Alimentation", budget.all_categories(self.con))


if __name__ == "__main__":
    unittest.main()
