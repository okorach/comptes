import sqlite3, os

DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "comptes.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY, number TEXT, bank TEXT, availability INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Open', currency TEXT DEFAULT 'EUR', type TEXT DEFAULT 'Courant',
  in_budget INTEGER DEFAULT 0, tax REAL DEFAULT 0, website TEXT,
  mode TEXT DEFAULT 'flow'  -- flow | snapshot | shares | static
);
CREATE TABLE IF NOT EXISTS account_types(name TEXT PRIMARY KEY, interest_period INTEGER, tax REAL);
CREATE TABLE IF NOT EXISTS categories(subcategory TEXT PRIMARY KEY, category TEXT);
CREATE TABLE IF NOT EXISTS substitutions(id INTEGER PRIMARY KEY, pattern TEXT, replacement TEXT);
CREATE TABLE IF NOT EXISTS fx_rates(currency TEXT, date TEXT, rate REAL, PRIMARY KEY(currency,date));
CREATE TABLE IF NOT EXISTS params(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL, amount_eur REAL, balance_eur REAL,
  native_amount REAL, native_balance REAL,
  description TEXT, subcategory TEXT, in_budget REAL, qty REAL, price REAL
);
CREATE INDEX IF NOT EXISTS ix_tr_acc ON transactions(account, date);
CREATE TABLE IF NOT EXISTS deposits(
  id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL, amount_eur REAL, native_amount REAL
);
CREATE INDEX IF NOT EXISTS ix_dep_acc ON deposits(account, date);
CREATE TABLE IF NOT EXISTS interests(
  account TEXT PRIMARY KEY, calc_date TEXT, y1 REAL, y3 REAL, y5 REAL, y8 REAL, y_all REAL,
  n1 REAL, n3 REAL, n5 REAL, n8 REAL, n_all REAL  -- same yields in the currency of the account (without the exchange rate effect)
);
"""


NATIVE_INTEREST_COLUMNS = ("n1", "n3", "n5", "n8", "n_all")


def _migrate(con):
    """Adds the columns introduced after the first version of the database"""
    cols = {r[1] for r in con.execute("PRAGMA table_info(interests)")}
    for c in NATIVE_INTEREST_COLUMNS:
        if c not in cols:
            con.execute(f"ALTER TABLE interests ADD COLUMN {c} REAL")


def connect(path=None):
    con = sqlite3.connect(path or DEFAULT_DB)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    _migrate(con)
    return con
