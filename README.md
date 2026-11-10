# Comptes

Local web app replacing `Comptes.xlsm` (macros: `D:\dev\excel-tools`). Pure Python standard library for the
server; `openpyxl` is only needed for the one-time workbook import and for `.xlsx` bank files.

## Run

```
pip install openpyxl
python -m comptes.import_xlsx "D:\Backup\GDrive\Banque\Comptes.xlsm"   # ONE TIME: creates comptes.db (deletes an existing one!)
python -m comptes.server                                                # then open http://localhost:8000
```

The database is a single SQLite file (`comptes.db`, git-ignored). Back it up like any other file.

## What it does

| Workbook | App |
|---|---|
| Account sheets (flow / balance / shares accounts, multi-currency) | Account page: add / edit / delete entries, balances recomputed automatically. Entries of a flow account can be in another currency than the account: the original amount is kept next to the amount in the account currency (entered, or converted at the exchange rate of the day), and the balance is in the account currency |
| `Solde`, `Solde par compte` | Overview: net worth over time, totals by bank / availability year / type |
| `Budget`, `Stats`, `Ventilation`, `Etude` pivots, `GenBudget` | **Dépenses** page (month / quarter / year, category matrix, 12-month average, spreading over N months) |
| (Excel filter on each sheet) | **Recherche** page: finds entries across all the accounts by free text (every word, accents and case ignored), account, category / sub-category, date range and amount range (absolute value, in the master currency, the account currency or the original currency). Each result links to the entry in its own account, which opens on it, highlighted; « Retour à la recherche » finds the search again |
| `Interests` sheet + Goal Seek | **Rendements** page, analytic solver (no Excel needed) |
| `BankImport*.bas` (BoursoBank, LCL, ING, UBS, Revolut, Yuh, generic CSV) | Import box on the account page, with preview and **duplicate detection** |
| Export / Import CSV with metadata row | `Exporter CSV` / import « generic » |
| Account creation form, exchange-rate tables | **Administration** page |
| (manual rate tables) | **Exchange rates retrieved from the internet** (ECB reference rates through frankfurter.dev, no key): one rate per week, from the oldest data of each currency, only for the weeks that have none yet. Done in the background each time the app starts (if the internet is reachable, silently skipped otherwise) and with the « Mettre à jour depuis Internet » button; balances and yields are then recomputed. Set `COMPTES_NO_FX_UPDATE=1` to never go online |
| (EUR only) | **Master currency** of the application (Administration page, EUR by default): totals, balances and yields of all accounts are computed in it, whatever the currency of each account. Changing it recomputes everything. Exchange rates stay stored as units of currency per EUR, so the master currency needs rates (EUR does not) |

## Rules reproduced from the workbook

* Account modes: `flow` (you enter amounts), `snapshot` (you enter the balance, amount = difference),
  `shares` (quantity x price), `static` (imported EUR values, e.g. PEE Peugeot francs).
* Foreign accounts: EUR = native / rate, rate = last rate on or before the date (rates are "units per 1 EUR").
* Budget: only accounts flagged in budget; row value N > 1 spreads the amount over N months, 0 excludes the row;
  categories Salaire, Epargne, Impôts excluded by default.

## Tests (`tests/`)

* `verify_recompute.py <db>`: recomputed balances equal the workbook's (64 of 66 accounts exact; the other two
  contain one hand-typed amount each).
* `verify_interest.py <db>`: yields equal the workbook's `Interests` sheet (78 values, max diff 6e-8).
* `smoke_api.py`, `ui_render.js`: API and UI smoke tests.

## Known differences from the workbook

* Overview shows each account's latest balance (at the latest FX rate); the workbook's `Solde par compte`
  pivot sums historical EUR amounts, which differs slightly for CHF accounts.
* 4 BoursoBank Elodie rows had no date in the workbook; they are kept, dated like the previous row (2025-07-18).
* Bank importers were ported from the VBA but only unit-tested on synthetic data: try each bank with a real file.
* The Boursorama card-statement text converter (`bourso_cb.py`) was not ported.
