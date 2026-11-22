-- Starting point for the staging database. Accounts, guilds, and invites come after the merge prototype.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '1');
