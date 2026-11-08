"""Accounts take transactions in a currency other than their own: both amounts are kept, the balance is in the account currency"""
import csv
import io
import os
import sqlite3
import tempfile
import unittest

from helpers import make_db
from comptes import bankimport, calc, db, ops


class MultiCurrencyTest(unittest.TestCase):
    def setUp(self):
        self.con, self.path = make_db()
        # CHF: 2 per EUR from 2021, USD: 1.25 per EUR
        self.con.execute("INSERT INTO fx_rates VALUES('USD','2020-01-01',1.25)")
        self.con.commit()

    def tearDown(self):
        self.con.close()
        os.remove(self.path)

    def rows(self, account="Suisse"):
        return [dict(r) for r in self.con.execute("SELECT * FROM transactions WHERE account=? ORDER BY date,id", (account,))]

    def test_amount_is_converted_into_the_account_currency(self):
        ops.add_transaction(self.con, "Suisse", {"date": "2022-01-01", "native_amount": "1000"})
        ops.add_transaction(self.con, "Suisse", {"date": "2022-02-01", "fx_currency": "usd", "fx_amount": "-100"})
        first, second = self.rows()
        # 100 USD = 80 EUR = 160 CHF
        self.assertEqual((second["fx_currency"], second["fx_amount"], second["fx_auto"]), ("USD", -100.0, 1))
        self.assertAlmostEqual(second["native_amount"], -160.0)
        self.assertAlmostEqual(second["native_balance"], 840.0)  # balance in CHF
        self.assertAlmostEqual(second["amount_eur"], -80.0)
        self.assertAlmostEqual(second["balance_eur"], 420.0)
        self.assertIsNone(first["fx_currency"])

    def test_entered_amount_is_kept(self):
        """The amount really debited (exchange fees included) wins over the conversion"""
        ops.add_transaction(self.con, "Suisse", {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-100", "native_amount": "-165"})
        row = self.rows()[0]
        self.assertEqual((row["native_amount"], row["fx_auto"]), (-165.0, 0))
        self.assertEqual(row["native_balance"], -165.0)

    def test_eur_account_with_a_foreign_transaction(self):
        ops.add_transaction(self.con, "Courant", {"date": "2022-02-01", "fx_currency": "CHF", "fx_amount": "-20"})
        row = self.rows("Courant")[0]
        self.assertAlmostEqual(row["native_amount"], -10.0)
        self.assertAlmostEqual(row["balance_eur"], -10.0)

    def test_converted_amount_follows_the_exchange_rates_but_entered_amount_does_not(self):
        ops.add_transaction(self.con, "Suisse", {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-100"})
        ops.add_transaction(self.con, "Suisse", {"date": "2022-02-02", "fx_currency": "USD", "fx_amount": "-100", "native_amount": "-160"})
        ops.add_fx(self.con, "USD", "2022-01-01", 2.0)
        calc.recompute_account(self.con, "Suisse")
        auto, entered = self.rows()
        self.assertAlmostEqual(auto["native_amount"], -100.0)  # 100 USD = 50 EUR = 100 CHF
        self.assertEqual(entered["native_amount"], -160.0)

    def test_update_switches_between_converted_and_entered(self):
        tid = ops.add_transaction(self.con, "Suisse", {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-100"})
        ops.update_transaction(self.con, tid, {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-100", "native_amount": "-150"})
        self.assertEqual(self.rows()[0]["native_amount"], -150.0)
        ops.update_transaction(self.con, tid, {"date": "2022-02-01", "native_amount": "-150"})  # back to a transaction in CHF
        row = self.rows()[0]
        self.assertEqual((row["fx_currency"], row["fx_amount"], row["fx_auto"]), (None, None, 0))
        ops.update_transaction(self.con, tid, {"date": "2022-02-01", "fx_currency": "USD", "fx_amount": "-50"})
        self.assertAlmostEqual(self.rows()[0]["native_amount"], -80.0)

    def test_invalid_original_amounts_are_refused(self):
        bad = [("Suisse", {"fx_currency": "USD"}), ("Suisse", {"fx_amount": "10"}),
               ("Suisse", {"fx_currency": "CHF", "fx_amount": "10"}),     # same currency as the account
               ("Epargne", {"fx_currency": "USD", "fx_amount": "10"}),    # balance account
               ("Suisse", {"fx_currency": "JPY", "fx_amount": "10"})]     # no exchange rate
        for acc, extra in bad:
            with self.subTest(acc=acc, extra=extra), self.assertRaises(ValueError):
                ops.add_transaction(self.con, acc, {"date": "2022-02-01", **extra})
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 0)

    def test_existing_databases_get_the_new_columns(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            old = sqlite3.connect(path)
            old.execute("CREATE TABLE transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, date TEXT NOT NULL, "
                        "amount_eur REAL, balance_eur REAL, native_amount REAL, native_balance REAL, description TEXT, subcategory TEXT, "
                        "in_budget REAL, qty REAL, price REAL)")
            old.execute("INSERT INTO transactions(account,date,native_amount) VALUES('A','2024-01-01',5)")
            old.commit()
            old.close()
            con = db.connect(path)
            row = con.execute("SELECT * FROM transactions").fetchone()
            self.assertEqual((row["native_amount"], row["fx_currency"], row["fx_amount"], row["fx_auto"]), (5.0, None, None, 0))
            con.close()
        finally:
            os.remove(path)

    def test_generic_import_reads_the_original_amount(self):
        """Rows of the CSV export (original currency and amount in the last 2 columns) are imported with them"""
        text = "ExportDate=2024-01-01,NbrTransactions=2\n2022-03-01,100,100,Salary,\n2022-03-02,-160,-60,US,,USD,-100\n"
        parsed = bankimport.parse_generic(list(csv.reader(io.StringIO(text))))
        self.assertNotIn("fx_currency", parsed[0])
        self.assertEqual((parsed[1]["fx_currency"], parsed[1]["fx_amount"], parsed[1]["amount"]), ("USD", -100.0, -160.0))
        new, _ = bankimport.split_new(self.con, "Suisse", parsed)
        bankimport.commit_new(self.con, "Suisse", new)
        first, second = self.rows()
        self.assertEqual((first["fx_currency"], second["fx_currency"], second["fx_amount"], second["fx_auto"]), (None, "USD", -100.0, 0))
        self.assertEqual((second["native_amount"], second["native_balance"]), (-160.0, -60.0))
