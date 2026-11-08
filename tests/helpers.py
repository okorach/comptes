"""Synthetic fixtures for the unit tests (no personal data)."""
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from comptes.db import connect  # noqa: E402


def make_db():
    """Create a temporary database with a few synthetic accounts and FX rates."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    con = connect(path)
    con.executemany(
        "INSERT INTO accounts(id,bank,currency,type,in_budget,tax,mode) VALUES(?,?,?,?,?,?,?)",
        [("Courant", "BankA", "EUR", "Courant", 1, 0.0, "flow"),
         ("Epargne", "BankA", "EUR", "Livret", 0, 0.30, "snapshot"),
         ("Suisse", "BankB", "CHF", "Courant", 0, 0.0, "flow"),
         ("Actions", "BankC", "EUR", "PEA", 0, 0.0, "shares")])
    con.execute("INSERT INTO account_types VALUES('Livret',1,0.30)")
    con.executemany("INSERT INTO categories VALUES(?,?)",
                    [("Courses", "Alimentation"), ("Paie", "Salaire"), ("Loisirs", "Divers")])
    con.executemany("INSERT INTO fx_rates VALUES(?,?,?)",
                    [("CHF", "2020-01-01", 1.0), ("CHF", "2021-01-01", 2.0)])
    con.commit()
    return con, path


class UsdDatabaseCase(unittest.TestCase):
    """Test case on a synthetic database that also has an exchange rate for the USD (per EUR: CHF 2 from 2021, USD 1.25)"""
    def setUp(self):
        self.con, self.path = make_db()
        self.con.execute("INSERT INTO fx_rates VALUES('USD','2020-01-01',1.25)")
        self.con.commit()

    def tearDown(self):
        self.con.close()
        os.remove(self.path)


def make_legacy_database():
    """Path of a database as created by the first version: amounts in EUR in *_eur columns, no original amount, no master currency"""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, date TEXT NOT NULL, "
                "amount_eur REAL, balance_eur REAL, native_amount REAL, native_balance REAL, description TEXT, subcategory TEXT, "
                "in_budget REAL, qty REAL, price REAL)")
    old.execute("CREATE TABLE deposits(id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, date TEXT NOT NULL, "
                "amount_eur REAL, native_amount REAL)")
    old.execute("INSERT INTO transactions(account,date,amount_eur,balance_eur,native_amount) VALUES('A','2024-01-01',5,7,5)")
    old.execute("INSERT INTO deposits(account,date,amount_eur) VALUES('A','2024-01-01',3)")
    old.commit()
    old.close()
    return path
