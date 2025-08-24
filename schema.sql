-- schema.sql
CREATE TABLE IF NOT EXISTS cookies_chunks (
    uuid TEXT,
    seq INTEGER,
    chunk TEXT NOT NULL,
    PRIMARY KEY (uuid, seq)
);