"""Search of transactions across all the accounts: free text, category, dates, amounts"""
import unittest

from helpers import UsdDatabaseCase
from comptes import ops, search


class SearchTest(UsdDatabaseCase):
    def setUp(self):
        super().setUp()
        add = ops.add_transaction
        add(self.con, "Courant", {"date": "2024-01-10", "native_amount": "-50", "description": "Café de l'Été", "subcategory": "Courses"})
        add(self.con, "Courant", {"date": "2024-02-10", "native_amount": "1500", "description": "Salaire janvier", "subcategory": "Paie"})
        add(self.con, "Courant", {"date": "2024-03-10", "native_amount": "-12.5", "description": "Cinéma", "subcategory": "Loisirs"})
        add(self.con, "Suisse", {"date": "2024-02-20", "native_amount": "200", "description": "Virement"})                       # 100 EUR from 2021
        add(self.con, "Courant", {"date": "2024-02-25", "fx_currency": "USD", "fx_amount": "-100", "description": "Hotel"})  # -80 EUR

    def ids(self, **criteria):
        return [r["description"] for r in search.run(self.con, criteria)["rows"]]

    def test_no_criteria_lists_everything_most_recent_first(self):
        result = search.run(self.con, {})
        self.assertEqual((result["total"], result["truncated"]), (5, False))
        self.assertEqual([r["date"] for r in result["rows"]], sorted((r["date"] for r in result["rows"]), reverse=True))

    def test_rows_tell_where_the_transaction_is(self):
        row = search.run(self.con, {"text": "virement"})["rows"][0]
        self.assertEqual((row["account"], row["currency"], row["amount_main"], row["native_amount"]), ("Suisse", "CHF", 100.0, 200.0))
        self.assertEqual(self.con.execute("SELECT account FROM transactions WHERE id=?", (row["id"],)).fetchone()[0], "Suisse")

    def test_text_ignores_case_and_accents_and_needs_every_word(self):
        self.assertEqual(self.ids(text="CAFE ete"), ["Café de l'Été"])
        self.assertEqual(self.ids(text="salaire"), ["Salaire janvier"])
        self.assertEqual(self.ids(text="salaire cinema"), [])
        self.assertEqual(self.ids(text="loisirs"), ["Cinéma"])   # the sub-category too

    def test_text_with_sql_wildcards_is_literal(self):
        self.assertEqual(self.ids(text="%"), [])
        self.assertEqual(self.ids(text="_"), [])

    def test_category_and_subcategory(self):
        self.assertEqual(self.ids(category="Alimentation"), ["Café de l'Été"])
        self.assertEqual(self.ids(subcategory="Paie"), ["Salaire janvier"])
        self.assertEqual(self.ids(category="Alimentation", subcategory="Paie"), [])
        self.assertEqual(search.run(self.con, {"subcategory": "Paie"})["rows"][0]["category"], "Salaire")

    def test_date_range_includes_both_ends(self):
        self.assertEqual(self.ids(date_from="2024-02-10", date_to="2024-02-25"), ["Hotel", "Virement", "Salaire janvier"])
        self.assertEqual(self.ids(date_from="2024-03-01"), ["Cinéma"])
        self.assertEqual(self.ids(date_to="2024-01-10"), ["Café de l'Été"])

    def test_amount_is_an_absolute_value_range(self):
        self.assertEqual(self.ids(amount_min="50", amount_max="50"), ["Café de l'Été"])
        self.assertEqual(self.ids(amount_min="1000"), ["Salaire janvier"])
        self.assertEqual(self.ids(amount_max="20"), ["Cinéma"])
        self.assertEqual(self.ids(amount_min="12,5", amount_max="12,5"), ["Cinéma"])   # a comma is accepted
        self.assertEqual(self.ids(amount_min="60", amount_max="40"), ["Café de l'Été"])  # bounds given the wrong way round

    def test_amount_is_also_searched_in_the_currency_of_the_account_and_in_the_original_currency(self):
        self.assertEqual(self.ids(amount_min="200", amount_max="200"), ["Virement"])    # 200 CHF (100 in the master currency)
        self.assertEqual(self.ids(amount_min="100", amount_max="100"), ["Hotel", "Virement"])  # 100 USD, and 100 EUR

    def test_criteria_are_combined(self):
        self.assertEqual(self.ids(account="Courant", date_from="2024-02-01", amount_max="100"), ["Cinéma", "Hotel"])
        self.assertEqual(self.ids(account="Suisse"), ["Virement"])
        self.assertEqual(self.ids(text="hotel", account="Suisse"), [])

    def test_the_number_of_rows_is_limited_but_the_total_is_given(self):
        result = search.run(self.con, {"limit": "2"})
        self.assertEqual((len(result["rows"]), result["total"], result["truncated"]), (2, 5, True))

    def test_invalid_criteria_are_refused(self):
        for criteria in ({"date_from": "hier"}, {"date_to": "2024-13-01"}, {"amount_min": "beaucoup"}, {"limit": "x"}):
            with self.subTest(criteria=criteria), self.assertRaises(ValueError):
                search.run(self.con, criteria)

    def test_rank_in_account_tells_how_far_back_to_load(self):
        ids = {r["description"]: r["id"] for r in search.run(self.con, {})["rows"]}
        self.assertEqual(search.rank_in_account(self.con, "Courant", ids["Cinéma"]), 1)
        self.assertEqual(search.rank_in_account(self.con, "Courant", ids["Café de l'Été"]), 4)
        self.assertEqual(search.rank_in_account(self.con, "Suisse", ids["Cinéma"]), 0)   # not in this account


if __name__ == "__main__":
    unittest.main()
