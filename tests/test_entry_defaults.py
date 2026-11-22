"""What the entries of a life insurance (a balance) and of a share account (a price) get when the user does not give it"""
from helpers import UsdDatabaseCase
from comptes import ops


class EntryDefaultsTest(UsdDatabaseCase):
    def setUp(self):
        super().setUp()
        self.con.executemany(
            "INSERT INTO accounts(id,bank,currency,type,mode) VALUES(?,?,?,?,?)",
            [("AV", "B", "EUR", "Assurance Vie", "snapshot"), ("HPE", "B", "USD", "Actions", "shares"), ("NAT", "B", "EUR", "Actions", "shares")])
        self.con.commit()

    def row(self, tid):
        return self.con.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()

    def test_life_insurance_balance_gets_the_category_and_the_description(self):
        first = self.row(ops.add_transaction(self.con, "AV", {"date": "2026-10-30", "native_balance": "1000"}))
        self.assertEqual((first["subcategory"], first["description"]), ("Epargne", "Delta Solde 2026-10-30"))   # no previous entry: its own date
        second = self.row(ops.add_transaction(self.con, "AV", {"date": "2026-11-07", "native_balance": "1100", "description": "  "}))
        self.assertEqual((second["subcategory"], second["description"]), ("Epargne", "Delta Solde 2026-10-30"))   # the date of the previous entry
        given = self.row(ops.add_transaction(self.con, "AV", {"date": "2026-11-13", "native_balance": "1200", "description": "Mine", "subcategory": "Impôts"}))
        self.assertEqual((given["subcategory"], given["description"]), ("Impôts", "Mine"))                    # what is given is kept

    def test_shares_only_need_the_price(self):
        first = self.row(ops.add_transaction(self.con, "HPE", {"date": "2026-10-30", "qty": "1221,739", "price": "44.77"}))
        self.assertEqual(first["description"], "Delta 2026-10-30: 1221,739 shares @ $44,77 / 1,25 (USD vers EUR)")
        self.assertEqual(first["subcategory"], "Epargne")
        second = self.row(ops.add_transaction(self.con, "HPE", {"date": "2026-11-07", "price": "48.1"}))
        self.assertEqual(second["qty"], 1221.739)                                                             # the number of the previous entry
        self.assertEqual(second["description"], "Delta 2026-10-30: 1221,739 shares @ $48,10 / 1,25 (USD vers EUR)")
        self.assertAlmostEqual(second["native_balance"], 1221.739 * 48.1, 3)
        entry = {"date": "2026-11-13", "qty": "1000", "price": "50", "description": "Vente", "subcategory": "X"}
        changed = self.row(ops.add_transaction(self.con, "HPE", entry))
        self.assertEqual((changed["qty"], changed["description"], changed["subcategory"]), (1000.0, "Vente", "X"))

    def test_the_price_is_required_and_so_is_the_number_of_shares_of_the_first_entry(self):
        with self.assertRaisesRegex(ValueError, "Prix unitaire requis"):
            ops.add_transaction(self.con, "HPE", {"date": "2026-10-30", "qty": "10"})
        with self.assertRaisesRegex(ValueError, "Nombre de titres requis"):
            ops.add_transaction(self.con, "HPE", {"date": "2026-10-30", "price": "10"})
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM transactions WHERE account='HPE'").fetchone()[0], 0)

    def test_shares_in_the_currency_of_the_application_have_no_rate_in_the_description(self):
        row = self.row(ops.add_transaction(self.con, "NAT", {"date": "2026-10-30", "qty": "10", "price": "12.3456"}))
        self.assertEqual(row["description"], "Delta 2026-10-30: 10 shares @ €12,3456")

    def test_other_accounts_and_the_edit_are_left_alone(self):
        row = self.row(ops.add_transaction(self.con, "Courant", {"date": "2026-10-30", "native_amount": "-5"}))
        self.assertEqual((row["subcategory"], row["description"]), (None, None))
        tid = ops.add_transaction(self.con, "AV", {"date": "2026-10-30", "native_balance": "1000"})
        ops.update_transaction(self.con, tid, {"date": "2026-10-30", "native_balance": "1000", "description": "", "subcategory": ""})
        edited = self.row(tid)
        self.assertEqual((edited["subcategory"], edited["description"]), (None, ""))                         # only a new entry gets the defaults
