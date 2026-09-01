-- The arcade leaderboard: one database for every game, forever.
--
-- `board` is the tenant key, so a new game is a new prefix and never new
-- infrastructure: 'shutthecube:medium:2026-09-01', 'beats:color:alltime'.

-- Players. Deliberately thin: the Google account id and a name, and nothing
-- else. No email, no avatar, no tokens. What is not stored cannot leak, and
-- makes the deletion promise on the privacy page trivial to keep.
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,          -- our own id, never Google's
  sub         TEXT NOT NULL UNIQUE,      -- Google's opaque subject id
  name        TEXT NOT NULL,             -- display name, editable by the player
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board       TEXT NOT NULL,             -- '<game>:<mode>:<period>'
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  won         INTEGER NOT NULL DEFAULT 0,
  rolls       INTEGER NOT NULL DEFAULT 0,
  seed        INTEGER,                   -- the board this was played on
  proof       TEXT,                      -- the move list, replayed to verify
  created_at  INTEGER NOT NULL
);

-- One entry per player per board: a leaderboard is a ranking of people, not
-- of attempts, and without this a single player could fill the whole table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_one_per_player
  ON scores (board, player_id);

-- The whole read path: "top N on this board", as one indexed scan.
CREATE INDEX IF NOT EXISTS idx_scores_ranking
  ON scores (board, score DESC, created_at ASC);

-- Short-lived login handoffs, so an OAuth redirect can hand the browser a
-- one-time code instead of putting a session token in a URL that ends up in
-- history and referrers.
CREATE TABLE IF NOT EXISTS handoffs (
  code        TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

-- OAuth state, to bind a callback to the request that started it (CSRF).
CREATE TABLE IF NOT EXISTS auth_states (
  state       TEXT PRIMARY KEY,
  redirect    TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
