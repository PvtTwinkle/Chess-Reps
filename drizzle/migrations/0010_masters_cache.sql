CREATE TABLE masters_cache (
  fen TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);