"""The application has a master currency (EUR by default): totals, balances and yields of all accounts are computed in it"""
import os
import unittest

from helpers import UsdDatabaseCase, make_legacy_database
from comptes import calc, db, interest, ops


class MasterCurrencyTest(UsdDatabaseCase):
    def main_balance(self, account):
        return self.con.execute("SELECT balance_main FROM transactions WHERE account=? ORDER BY date DESC,id DESC", (account,)).fetchone()[0]

    def test_default_is_eur(self):
        self.assertEqual(calc.master_currency(self.con), "EUR")
        self.assertEqual(calc.Fx(self.con).rate("CHF", "2022-01-01"), 2.0)

    def test_rates_are_relative_to_the_master_currency(self):
        ops.set_master_currency(self.con, "chf")
        fx = calc.Fx(self.con)
        self.assertEqual(calc.master_currency(self.con), "CHF")
        self.assertEqual(fx.rate("CHF", "2022-01-01"), 1.0)
        self.assertEqual(fx.rate("EUR", "2022-01-01"), 0.5)        # 1 CHF = 0.5 EUR
        self.assertEqual(fx.rate("USD", "2022-01-01"), 0.625)      # 1 CHF = 0.625 USD
        self.assertEqual(fx.rate("EUR", "2020-06-01"), 1.0)        # 1 CHF = 1 EUR before 2021

    def test_changing_the_master_currency_recomputes_the_balances(self):
        ops.add_transaction(self.con, "Courant", {"date": "2022-01-01", "native_amount": "100"})     # 100 EUR
        ops.add_transaction(self.con, "Suisse", {"date": "2022-01-01", "native_amount": "200"})      # 200 CHF = 100 EUR
        ops.add_deposit(self.con, "Suisse", "2022-01-01", "200")
        self.assertEqual((self.main_balance("Courant"), self.main_balance("Suisse")), (100.0, 100.0))
        ops.set_master_currency(self.con, "CHF")
        self.assertEqual((self.main_balance("Courant"), self.main_balance("Suisse")), (200.0, 200.0))
        self.assertEqual(self.con.execute("SELECT amount_main FROM deposits").fetchone()[0], 200.0)
        self.assertEqual(calc.net_worth_series(self.con)[-1]["total"], 400.0)
        self.assertEqual({a["id"]: a["balance_main"] for a in calc.account_summaries(self.con)}["Courant"], 200.0)
        ops.set_master_currency(self.con, "EUR")
        self.assertEqual((self.main_balance("Courant"), self.main_balance("Suisse")), (100.0, 100.0))
        self.assertEqual(self.con.execute("SELECT amount_main FROM deposits").fetchone()[0], 100.0)

    def test_deposit_imported_without_amount_in_the_account_currency_is_not_lost(self):
        self.con.execute("INSERT INTO deposits(account,date,amount_main) VALUES('Suisse','2022-01-01',100.0)")  # 100 EUR = 200 CHF
        ops.set_master_currency(self.con, "CHF")
        self.assertEqual(tuple(self.con.execute("SELECT amount_main,native_amount FROM deposits").fetchone()), (200.0, 200.0))
        ops.set_master_currency(self.con, "EUR")
        self.assertEqual(self.con.execute("SELECT amount_main FROM deposits").fetchone()[0], 100.0)

    def test_account_in_the_master_currency_keeps_its_amounts(self):
        ops.set_master_currency(self.con, "CHF")
        ops.add_transaction(self.con, "Suisse", {"date": "2022-01-01", "native_amount": "200"})
        row = self.con.execute("SELECT native_amount,amount_main,balance_main FROM transactions").fetchone()
        self.assertEqual(tuple(row), (200.0, 200.0, 200.0))

    def test_other_currency_transaction_converts_through_the_master_currency(self):
        ops.set_master_currency(self.con, "CHF")
        ops.add_transaction(self.con, "Courant", {"date": "2022-01-01", "fx_currency": "USD", "fx_amount": "-100"})
        row = self.con.execute("SELECT native_amount,amount_main FROM transactions").fetchone()
        self.assertAlmostEqual(row["native_amount"], -80.0)   # 100 USD = 80 EUR
        self.assertAlmostEqual(row["amount_main"], -160.0)    # = 160 CHF

    def test_new_accounts_default_to_the_master_currency(self):
        ops.set_master_currency(self.con, "CHF")
        ops.create_account(self.con, {"id": "Nouveau"})
        self.assertEqual(self.con.execute("SELECT currency FROM accounts WHERE id='Nouveau'").fetchone()[0], "CHF")

    def test_yields_in_the_account_currency_are_kept_for_accounts_other_than_the_master_currency(self):
        # 100 -> 110 over one year in the account currency
        for acc in ("Courant", "Suisse"):
            self.con.executemany("INSERT INTO transactions(account,date,native_amount,native_balance) VALUES(?,?,?,?)",
                                 [(acc, "2023-01-01", 100.0, 100.0), (acc, "2024-01-01", 10.0, 110.0)])
            self.con.execute("INSERT INTO deposits(account,date,native_amount) VALUES(?,'2023-01-01',100.0)", (acc,))
            calc.recompute_account(self.con, acc)
        ops.set_master_currency(self.con, "CHF")
        self.con.execute("UPDATE accounts SET type='Investment' WHERE id IN ('Courant','Suisse')")
        interest.recalc(self.con, "Courant")
        interest.recalc(self.con, "Suisse")
        rows = {r["account"]: r for r in self.con.execute("SELECT * FROM interests")}
        self.assertIsNotNone(rows["Courant"]["n_all"])   # EUR account, the master currency being CHF
        self.assertIsNone(rows["Suisse"]["n_all"])

    def test_invalid_or_unknown_currencies_are_refused_and_nothing_changes(self):
        ops.add_transaction(self.con, "Courant", {"date": "2022-01-01", "native_amount": "100"})
        for bad in ("", "EU", "12$", "JPY"):  # JPY: no exchange rate
            with self.subTest(currency=bad), self.assertRaises(ValueError):
                ops.set_master_currency(self.con, bad)
        self.assertEqual(calc.master_currency(self.con), "EUR")
        self.assertEqual(self.main_balance("Courant"), 100.0)


class RenamedColumnsTest(unittest.TestCase):
    def test_databases_created_before_get_the_columns_renamed_with_their_values(self):
        path = make_legacy_database()
        try:
            con = db.connect(path)
            t = con.execute("SELECT * FROM transactions").fetchone()
            self.assertEqual((t["amount_main"], t["balance_main"]), (5.0, 7.0))
            self.assertNotIn("amount_eur", t.keys())
            self.assertEqual(con.execute("SELECT amount_main FROM deposits").fetchone()[0], 3.0)
            self.assertEqual(calc.master_currency(con), "EUR")
            con.close()
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
