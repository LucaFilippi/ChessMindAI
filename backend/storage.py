"""SQLite metadata; compact per-game records live on disk, never dense tensors."""
import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager

ROOT = Path(os.environ.get('CHESSMIND_DATA', Path(__file__).resolve().parents[1] / 'data'))

@contextmanager
def db():
    ROOT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(ROOT / 'chessmind.db', timeout=60)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

def init():
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY, player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
          hash TEXT NOT NULL, date TEXT, headers TEXT NOT NULL, path TEXT NOT NULL,
          examples INTEGER NOT NULL, split TEXT NOT NULL, stats TEXT NOT NULL,
          UNIQUE(player_id, hash));
        CREATE INDEX IF NOT EXISTS games_player_split ON games(player_id, split, id);
        CREATE TABLE IF NOT EXISTS models (
          id INTEGER PRIMARY KEY, player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
          version INTEGER NOT NULL, path TEXT NOT NULL, metrics TEXT NOT NULL,
          config TEXT NOT NULL, games INTEGER NOT NULL, positions INTEGER NOT NULL,
          created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
          created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS predictions (
          id INTEGER PRIMARY KEY, player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
          model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
          fen TEXT NOT NULL, history TEXT NOT NULL, moves TEXT NOT NULL, actual TEXT,
          evaluation TEXT NOT NULL DEFAULT 'interactive', created TEXT DEFAULT CURRENT_TIMESTAMP);
        ''')
        c.execute("UPDATE jobs SET status='interrupted' WHERE status IN ('running','queued','pausing')")
