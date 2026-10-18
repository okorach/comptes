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
| Account sheets (flow / balance / shares accounts, multi-currency) | Account page: add / edit / delete entries, balances recomputed automatically |
| `Solde`, `Solde par compte` | Overview: net worth over time, totals by bank / availability year / type |
| `Budget`, `Stats`, `Ventilation`, `Etude` pivots, `GenBudget` | **Dépenses** page (month / quarter / year, category matrix, 12-month average, spreading over N months) |
| `Interests` sheet + Goal Seek | **Rendements** page, analytic solver (no Excel needed) |
| `BankImport*.bas` (BoursoBank, LCL, ING, UBS, Revolut, Yuh, generic CSV) | Import box on the account page, with preview and **duplicate detection** |
| Export / Import CSV with metadata row | `Exporter CSV` / import « generic » |
| Account creation form, exchange-rate tables | **Administration** page |

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
