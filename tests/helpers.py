"""Synthetic fixtures for the unit tests (no personal data)."""
import os
import sys
import tempfile

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
