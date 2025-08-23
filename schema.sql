-- schema.sql
DROP TABLE IF EXISTS cookies;
CREATE TABLE cookies (
  uuid TEXT PRIMARY KEY NOT NULL,
  encrypted_data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);