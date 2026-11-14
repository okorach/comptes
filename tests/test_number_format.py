"""Format of the numbers: decimal separator ("." or ",") and thousands separator (empty or a single character)"""
import unittest

from helpers import UsdDatabaseCase
from comptes import calc, import_xlsx, ops
from comptes.db import connect


class NumberFormatTest(UsdDatabaseCase):
    def test_default_is_a_point_and_a_space(self):
        self.assertEqual(calc.number_format(self.con), {"decimal": ".", "thousands": " "})

    def test_the_format_is_kept_in_the_database_over_the_runs_of_the_application(self):
        ops.set_number_format(self.con, ",", "'")
        self.con.close()
        reopened = connect(self.path)   # another run: the database is opened again
        try:
            self.assertEqual(calc.number_format(reopened), {"decimal": ",", "thousands": "'"})
        finally:
            reopened.close()
        self.con = connect(self.path)

    def test_a_format_is_kept(self):
        for decimal, thousands in ((".", ","), (",", "."), (".", ""), (",", " "), (".", "'"), (",", "\u202f"), (".", "_"), (".", "é")):
            with self.subTest(decimal=decimal, thousands=thousands):
                ops.set_number_format(self.con, decimal, thousands)
                self.assertEqual(calc.number_format(self.con), {"decimal": decimal, "thousands": thousands})

    def test_invalid_formats_are_refused_and_nothing_changes(self):
        ops.set_number_format(self.con, ".", "'")
        for decimal, thousands in (("x", ","), ("", ","), (None, ","), (",", ","), (".", "."), (".", "12"), (".", "5"), (".", "-"), (".", "+"),
                                   (".", "<"), (".", "&"), (".", '"'), (".", "'x"), (".", "\n"), (".", "\t"), (".", None), (".", 5)):
            with self.subTest(decimal=decimal, thousands=thousands), self.assertRaises(ValueError):
                ops.set_number_format(self.con, decimal, thousands)
        self.assertEqual(calc.number_format(self.con), {"decimal": ".", "thousands": "'"})

    def test_the_decimal_separator_may_be_the_thousands_separator_of_the_other_format(self):
        ops.set_number_format(self.con, ",", ".")
        ops.set_number_format(self.con, ".", ",")   # the other way round is fine too
        self.assertEqual(calc.number_format(self.con), {"decimal": ".", "thousands": ","})

    def test_the_format_survives_a_new_import_of_the_workbook(self):
        ops.set_number_format(self.con, ",", "'")
        self.con.commit()
        kept = import_xlsx.kept_settings(self.path)
        self.assertEqual(kept, {"decimal_separator": ",", "thousands_separator": "'"})
        self.assertEqual(import_xlsx.kept_settings(self.path + ".missing"), {})   # no database yet: nothing to keep


if __name__ == "__main__":
    unittest.main()
