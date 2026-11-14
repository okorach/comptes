"""An account can only be closed when its balance is zero"""
import unittest

from helpers import UsdDatabaseCase
from comptes import ops


class CloseAccountTest(UsdDatabaseCase):
    def status(self, account):
        return self.con.execute("SELECT status FROM accounts WHERE id=?", (account,)).fetchone()[0]

    def test_an_account_without_transactions_can_be_closed(self):
        ops.set_status(self.con, "Courant", "Closed")
        self.assertEqual(self.status("Courant"), "Closed")

    def test_an_account_with_a_zero_balance_can_be_closed(self):
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-01", "native_amount": "100"})
        ops.add_transaction(self.con, "Courant", {"date": "2024-02-01", "native_amount": "-100"})
        ops.set_status(self.con, "Courant", "Closed")
        self.assertEqual(self.status("Courant"), "Closed")

    def test_an_account_with_a_balance_cannot_be_closed(self):
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-01", "native_amount": "612.15"})
        with self.assertRaises(ValueError) as error:
            ops.set_status(self.con, "Courant", "Closed")
        self.assertIn("solde n'est pas nul (612,15 EUR)", str(error.exception))
        self.assertEqual(self.status("Courant"), "Open")

    def test_a_negative_balance_cannot_be_closed_either_and_the_currency_of_the_account_is_given(self):
        ops.add_transaction(self.con, "Suisse", {"date": "2024-01-01", "native_amount": "-40"})
        with self.assertRaises(ValueError) as error:
            ops.set_status(self.con, "Suisse", "Closed")
        self.assertIn("(-40,00 CHF)", str(error.exception))

    def test_a_balance_that_rounds_to_zero_is_zero(self):
        self.con.execute("INSERT INTO transactions(account,date,native_amount,native_balance,balance_main) VALUES('Courant','2024-01-01',0,0.001,0.001)")
        ops.set_status(self.con, "Courant", "Closed")
        self.assertEqual(self.status("Courant"), "Closed")

    def test_reopening_is_always_possible(self):
        ops.add_transaction(self.con, "Courant", {"date": "2024-01-01", "native_amount": "5"})
        self.con.execute("UPDATE accounts SET status='Closed' WHERE id='Courant'")
        ops.set_status(self.con, "Courant", "Open")
        self.assertEqual(self.status("Courant"), "Open")


if __name__ == "__main__":
    unittest.main()
