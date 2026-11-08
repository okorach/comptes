"""Exchange rates retrieved from the internet: one per week, only what is missing, nothing is lost when offline"""
import datetime as dt
import io
import json
import os
import unittest
import urllib.error
from unittest import mock

from helpers import UsdDatabaseCase
from comptes import ops, rates


def d(text):
    return dt.date.fromisoformat(text)


def business_days(start, end, skip=()):
    day = start
    while day <= end:
        if day.weekday() < 5 and day.isoformat() not in skip:
            yield day
        day += dt.timedelta(days=1)


class FakeService:
    """Stands for the internet: a rate every business day, equal to 1 + the number of days since 2020-01-01 / 1000"""
    def __init__(self, skip=()):
        self.calls = []
        self.skip = skip

    def __call__(self, currency, start, end):
        self.calls.append((currency, start, end))
        return {day.isoformat(): 1 + (day - d("2020-01-01")).days / 1000 for day in business_days(start, end, self.skip)}


class WeeksTest(unittest.TestCase):
    def test_monday(self):
        self.assertEqual(rates.monday(d("2024-01-10")), d("2024-01-08"))  # a Wednesday
        self.assertEqual(rates.monday(d("2024-01-08")), d("2024-01-08"))
        self.assertEqual(rates.monday(d("2024-01-14")), d("2024-01-08"))  # a Sunday

    def test_missing_weeks(self):
        have = {d("2024-01-15")}
        self.assertEqual(rates.missing_weeks(have, d("2024-01-10"), d("2024-01-24")), [d("2024-01-08"), d("2024-01-22")])
        self.assertEqual(rates.missing_weeks(have, d("2024-01-15"), d("2024-01-19")), [])

    def test_weekly_rates_keep_the_first_business_day_of_each_wanted_week(self):
        series = {"2024-01-08": 1.0, "2024-01-09": 1.1, "2024-01-16": 2.0, "2024-01-17": 2.1, "2024-01-22": 3.0}
        wanted = {d("2024-01-08"), d("2024-01-15")}
        self.assertEqual(rates.weekly_rates(series, wanted), {"2024-01-08": 1.0, "2024-01-16": 2.0})


class NeededCurrenciesTest(UsdDatabaseCase):
    def test_oldest_data_of_each_currency(self):
        self.con.executemany("INSERT INTO transactions(account,date,native_amount) VALUES(?,?,?)",
                             [("Suisse", "2019-05-15", 1.0), ("Suisse", "2022-01-01", 1.0), ("Courant", "2018-01-01", 1.0)])
        self.con.execute("INSERT INTO transactions(account,date,native_amount,fx_currency,fx_amount) VALUES('Courant','2021-03-02',-5,'USD',-6)")
        self.con.execute("INSERT INTO deposits(account,date,native_amount) VALUES('Suisse','2017-02-03',1.0)")
        self.assertEqual(rates.needed_currencies(self.con), {"CHF": "2017-02-03", "USD": "2021-03-02"})

    def test_currencies_without_data_are_not_requested(self):
        self.assertEqual(rates.needed_currencies(self.con), {})

    def test_the_master_currency_is_needed_since_the_first_transaction(self):
        self.con.execute("INSERT INTO transactions(account,date,native_amount) VALUES('Courant','2001-02-03',1.0)")
        ops.set_master_currency(self.con, "CHF")
        self.assertEqual(rates.needed_currencies(self.con), {"CHF": "2001-02-03"})


class RefreshTest(UsdDatabaseCase):
    def setUp(self):
        super().setUp()
        self.con.execute("INSERT INTO transactions(account,date,native_amount) VALUES('Suisse','2024-01-10',200)")  # CHF, a Wednesday
        self.con.commit()
        self.today = d("2024-01-24")

    def chf_rates(self):
        return [tuple(r) for r in self.con.execute("SELECT date,rate FROM fx_rates WHERE currency='CHF' AND date>='2024-01-01' ORDER BY date")]

    def test_one_rate_per_week_from_the_week_of_the_oldest_data(self):
        service = FakeService()
        result = rates.refresh(self.con, self.today, service)
        self.assertEqual(service.calls, [("CHF", d("2024-01-08"), self.today)])
        self.assertEqual([r[0] for r in self.chf_rates()], ["2024-01-08", "2024-01-15", "2024-01-22"])
        self.assertEqual((result["added"], result["currencies"], result["offline"], result["errors"]), (3, {"CHF": 3}, False, []))

    def test_the_first_business_day_is_used_when_the_monday_is_a_holiday(self):
        rates.refresh(self.con, self.today, FakeService(skip=("2024-01-15",)))
        self.assertEqual([r[0] for r in self.chf_rates()], ["2024-01-08", "2024-01-16", "2024-01-22"])

    def test_only_what_is_missing_is_requested_and_nothing_is_overwritten(self):
        self.con.execute("INSERT INTO fx_rates VALUES('CHF','2024-01-17',9.0)")  # entered by hand, middle of a week
        service = FakeService()
        rates.refresh(self.con, self.today, service)
        self.assertEqual([r[0] for r in self.chf_rates()], ["2024-01-08", "2024-01-17", "2024-01-22"])
        self.assertEqual(dict(self.chf_rates())["2024-01-17"], 9.0)
        service.calls.clear()
        result = rates.refresh(self.con, self.today, service)
        self.assertEqual((service.calls, result["added"]), ([], 0))   # up to date: no request at all
        later = rates.refresh(self.con, d("2024-01-30"), service)      # a new week: just that one
        self.assertEqual((service.calls, later["added"]), ([("CHF", d("2024-01-29"), d("2024-01-30"))], 1))

    def test_balances_are_recomputed_with_the_new_rates(self):
        ops.update_transaction(self.con, self.con.execute("SELECT id FROM transactions").fetchone()[0], {"date": "2024-01-10", "native_amount": "200"})
        self.assertEqual(self.con.execute("SELECT balance_main FROM transactions").fetchone()[0], 100.0)  # CHF = 2 per EUR (rate of 2021)
        rates.refresh(self.con, self.today, lambda cur, start, end: {"2024-01-08": 4.0})
        self.assertEqual(self.con.execute("SELECT balance_main FROM transactions").fetchone()[0], 50.0)

    def test_offline_changes_nothing_and_does_not_fail(self):
        def offline(*_):
            raise urllib.error.URLError("no network")
        result = rates.refresh(self.con, self.today, offline)
        self.assertEqual((result["offline"], result["added"], self.chf_rates()), (True, 0, []))
        self.assertIn("Pas de connexion", rates.describe(result))

    def test_a_currency_the_service_does_not_know_does_not_stop_the_others(self):
        self.con.execute("INSERT INTO transactions(account,date,native_amount,fx_currency,fx_amount) VALUES('Courant','2024-01-10',-5,'XXX',-6)")

        def service(cur, start, end):
            if cur == "XXX":
                raise rates.RatesError("HTTP 404")
            return FakeService()(cur, start, end)
        result = rates.refresh(self.con, self.today, service)
        self.assertEqual((result["currencies"], result["errors"]), ({"CHF": 3}, ["XXX: HTTP 404"]))
        self.assertIn("erreur XXX: HTTP 404", rates.describe(result))


class FetchTest(unittest.TestCase):
    BODY = {"base": "EUR", "rates": {"2024-01-08": {"CHF": 0.93}, "2024-01-09": {"CHF": 0.94}, "2024-01-10": {"USD": 1.1}}}

    def test_parses_the_rates_of_the_currency(self):
        with mock.patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(self.BODY).encode())) as opened:
            series = rates.fetch_rates("CHF", d("2024-01-08"), d("2024-01-10"))
        self.assertEqual(series, {"2024-01-08": 0.93, "2024-01-09": 0.94})
        url = opened.call_args[0][0]
        self.assertTrue(url.startswith("https://"))
        self.assertIn("2024-01-08..2024-01-10", url)
        self.assertIn("base=EUR&symbols=CHF", url)

    def test_http_errors_are_service_errors_but_network_errors_are_not(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 404, "not found", {}, None)):
            with self.assertRaises(rates.RatesError):
                rates.fetch_rates("XXX", d("2024-01-08"), d("2024-01-10"))
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaises(OSError):
                rates.fetch_rates("CHF", d("2024-01-08"), d("2024-01-10"))


class StartupTest(UsdDatabaseCase):
    def setUp(self):
        super().setUp()
        self.con.execute("INSERT INTO transactions(account,date,native_amount) VALUES('Suisse',date('now'),200)")
        self.con.commit()

    def test_missing_rates_are_retrieved_in_the_background(self):
        service = FakeService()
        with mock.patch.object(rates, "fetch_rates", service), mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(rates.DISABLE_ENV, None)
            thread = rates.update_in_background(self.path)
            thread.join(10)
        self.assertEqual([c[0] for c in service.calls], ["CHF"])
        self.assertGreaterEqual(self.con.execute("SELECT COUNT(*) FROM fx_rates WHERE currency='CHF' AND date>=date('now','-7 days')").fetchone()[0], 1)

    def test_can_be_disabled(self):
        service = FakeService()
        with mock.patch.object(rates, "fetch_rates", service), mock.patch.dict(os.environ, {rates.DISABLE_ENV: "1"}):
            self.assertIsNone(rates.update_in_background(self.path))
        self.assertEqual(service.calls, [])

    def test_a_failure_of_the_update_does_not_propagate(self):
        with mock.patch.object(rates, "refresh", side_effect=RuntimeError("boom")):
            rates._update(self.path)  # pylint: disable=protected-access


if __name__ == "__main__":
    unittest.main()
