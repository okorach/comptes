"""The yields shown are always up to date: what was not computed today is computed when the page asks for them"""
import datetime as dt
import unittest

from helpers import UsdDatabaseCase
from comptes import interest


class RecalcOutdatedTest(UsdDatabaseCase):
    NOW = dt.datetime(2024, 6, 15, 10, 30)

    def setUp(self):
        super().setUp()
        self.con.execute("DELETE FROM accounts")   # only the accounts of these tests
        self.con.executemany("INSERT INTO account_types VALUES(?,1,0)", [("PEA",), ("Actions",)])
        self.con.executemany("INSERT INTO accounts(id,bank,currency,type,in_budget,tax,mode,status) VALUES(?,?,?,?,?,?,?,?)",
                             [("PEA 1", "B", "EUR", "PEA", 0, 0.0, "flow", "Open"), ("Livret 1", "B", "EUR", "Livret A", 0, 0.0, "flow", "Open"),
                              ("Ferme", "B", "EUR", "PEA", 0, 0.0, "flow", "Closed")])
        for account in ("PEA 1", "Livret 1", "Ferme"):
            self.con.execute("INSERT INTO transactions(account,date,native_amount,native_balance,balance_main) VALUES(?,'2023-06-15',100,100,100)", (account,))
            self.con.execute("INSERT INTO transactions(account,date,native_amount,native_balance,balance_main) VALUES(?,'2024-06-01',10,110,110)", (account,))
        self.con.commit()

    def calc_dates(self):
        return {r["account"]: r["calc_date"] for r in self.con.execute("SELECT account,calc_date FROM interests")}

    def test_accounts_never_computed_are_computed(self):
        self.assertEqual(interest.recalc_outdated(self.con, self.NOW), 2)   # the two open accounts that have yields (not the closed one)
        dates = self.calc_dates()
        self.assertEqual(set(dates), {"PEA 1", "Livret 1"})
        self.assertTrue(all(d.startswith("2024-06-15") for d in dates.values()))

    def test_accounts_computed_today_are_left_alone_the_others_are_recomputed(self):
        self.con.execute("INSERT INTO interests(account,calc_date) VALUES('PEA 1','2024-06-15T08:00:00')")
        self.con.execute("INSERT INTO interests(account,calc_date) VALUES('Livret 1','2024-06-14T23:59:00')")
        self.assertEqual(interest.recalc_outdated(self.con, self.NOW), 1)
        dates = self.calc_dates()
        self.assertEqual(dates["PEA 1"], "2024-06-15T08:00:00")                 # computed today: untouched
        self.assertEqual(dates["Livret 1"], "2024-06-15T10:30:00")              # computed yesterday: recomputed
        self.assertEqual(interest.recalc_outdated(self.con, self.NOW), 0)       # nothing left to do

    def test_the_yearly_types_are_recomputed_too(self):
        interest.recalc_outdated(self.con, self.NOW)
        self.assertIn("Livret 1", self.calc_dates())   # Livret A is a yearly type: recalc_all() skips it unless forced

    def test_accounts_without_yields_are_not_computed(self):
        self.con.execute("UPDATE accounts SET type='Courant' WHERE id='PEA 1'")
        self.assertEqual(interest.recalc_outdated(self.con, self.NOW), 1)
        self.assertNotIn("PEA 1", self.calc_dates())


if __name__ == "__main__":
    unittest.main()
