import datetime as dt
import os
import unittest

from helpers import make_db
from comptes import bankimport as bi, calc


class ParsingTest(unittest.TestCase):
    def test_to_date(self):
        self.assertEqual(bi.to_date("2024-03-05"), "2024-03-05")
        self.assertEqual(bi.to_date("2024-03-05 10:11:12"), "2024-03-05")
        self.assertEqual(bi.to_date("05/03/2024"), "2024-03-05")
        self.assertEqual(bi.to_date("5.3.24"), "2024-03-05")
        self.assertEqual(bi.to_date("5 mars 2024"), "2024-03-05")
        self.assertEqual(bi.to_date(dt.datetime(2024, 3, 5, 1, 2)), "2024-03-05")
        self.assertEqual(bi.to_date(dt.date(2024, 3, 5)), "2024-03-05")
        with self.assertRaises(ValueError):
            bi.to_date("not a date")

    def test_to_amount(self):
        self.assertEqual(bi.to_amount(3), 3.0)
        self.assertEqual(bi.to_amount("-12,50"), -12.5)
        self.assertEqual(bi.to_amount("1 234,56 €"), 1234.56)
        self.assertEqual(bi.to_amount("1,234.56"), 1234.56)
        self.assertEqual(bi.to_amount("1.234,56"), 1234.56)
        self.assertEqual(bi.to_amount("5-"), -5.0)
        self.assertEqual(bi.to_amount("1'000.50"), 1000.5)

    def test_simplify(self):
        desc = "PRLV SEPA ACME : FACTURE 123 DE ACME REF 1"
        self.assertEqual(bi.delete_duplicate_sepa("CARTE X"), "CARTE X")
        self.assertTrue(len(bi.delete_duplicate_sepa(desc)) < len(desc))
        self.assertEqual(bi.simplify("  PAIEMENT PAR CARTE SHOP ", [("PAIEMENT PAR CARTE ", ""), ("", "x")]), "SHOP")

    def test_decode(self):
        self.assertEqual(bi.decode("é".encode("utf-8")), "é")
        self.assertEqual(bi.decode("é".encode("latin-1")), "é")


class DuplicateTest(unittest.TestCase):
    def setUp(self):
        self.con, self.path = make_db()

    def tearDown(self):
        self.con.close()
        os.remove(self.path)

    def test_split_and_commit(self):
        parsed = [{"date": "2024-01-01", "amount": -5.0, "description": "A", "subcategory": None},
                  {"date": "2024-01-02", "amount": -7.0, "description": "B"}]
        new, dup = bi.split_new(self.con, "Courant", parsed)
        self.assertEqual((len(new), len(dup)), (2, 0))
        bi.commit_new(self.con, "Courant", new)
        summ = {a["id"]: a for a in calc.account_summaries(self.con, "2024-12-31")}
        self.assertEqual(summ["Courant"]["balance_eur"], -12.0)
        # same file again: everything is a duplicate; a repeated line counts as one more new row
        new, dup = bi.split_new(self.con, "Courant", parsed + [parsed[0]])
        self.assertEqual((len(new), len(dup)), (1, 2))


if __name__ == "__main__":
    unittest.main()
