// Neon Postgres backing store for FinTrack.
// Single-row JSON document (`fintrack_store.key='main'`) so the existing
// ledger logic in server.js works unchanged on Vercel serverless, where the
// filesystem is ephemeral. Data lives in Neon, not in data/*.json.
//
// Concurrency (Milestone 2): the row carries a monotonically increasing
// `version`. Writers must present the version they read; the UPDATE succeeds
// only when it still matches (compare-and-swap). A mismatch means another
// writer committed first — the write is REJECTED (no blind last-write-wins)
// and the caller must refresh + retry deliberately (HTTP 409 upstream).
import { neon } from '@neondatabase/serverless';

export const isNeon = !!process.env.DATABASE_URL;
const STORE_KEY = 'main';

let sql = null;
function defaultClient() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

export async function initNeonSchema(db) {
  const client = db || (isNeon ? defaultClient() : null);
  if (!client) return;
  await client`CREATE TABLE IF NOT EXISTS fintrack_store (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  // Additive reliability migration: version column for optimistic concurrency.
  // Safe to run on every boot; existing rows default to version 1 and old
  // code (which never touches this column) keeps working.
  await client`ALTER TABLE fintrack_store ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1`;
}

// Legacy loader (kept for compatibility). Prefer loadDoc().
export async function loadFromNeon(fallbackEmpty) {
  const { data } = await loadDoc(fallbackEmpty);
  return data;
}

// Legacy blind writer (kept for compatibility; server.js no longer uses it).
// Prefer saveDoc().
export async function saveToNeon(dbData) {
  const db = defaultClient();
  await db`INSERT INTO fintrack_store (key, data, updated_at)
    VALUES (${STORE_KEY}, ${JSON.stringify(dbData)}, NOW())
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
}

// Versioned load: returns the document AND the version the writer must echo.
export async function loadDoc(fallbackEmpty, db = defaultClient()) {
  await initNeonSchema(db);
  const rows = await db`SELECT data, version, updated_at FROM fintrack_store WHERE key = ${STORE_KEY}`;
  if (!rows || rows.length === 0) {
    const empty = fallbackEmpty();
    await db`INSERT INTO fintrack_store (key, data, version) VALUES (${STORE_KEY}, ${JSON.stringify(empty)}, ${1}) ON CONFLICT (key) DO NOTHING`;
    const again = await db`SELECT data, version, updated_at FROM fintrack_store WHERE key = ${STORE_KEY}`;
    const row = again[0];
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return { data, version: Number(row.version) || 1, updatedAt: row.updated_at || null };
  }
  const row = rows[0];
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  return { data, version: Number(row.version) || 1, updatedAt: row.updated_at || null };
}

export class VersionConflictError extends Error {
  constructor(currentVersion) {
    super('Stored data changed since you read it — refresh and retry.');
    this.name = 'VersionConflictError';
    this.code = 'VERSION_CONFLICT';
    this.currentVersion = currentVersion;
  }
}

// Conditional write: commits ONLY if the stored version still equals
// expectedVersion, and bumps it atomically. Throws VersionConflictError
// otherwise. Never silently overwrites a newer version.
export async function saveDoc(dbData, expectedVersion, db = defaultClient()) {
  const payload = JSON.stringify(dbData);
  const rows = await db`UPDATE fintrack_store
    SET data = ${payload}, version = version + 1, updated_at = NOW()
    WHERE key = ${STORE_KEY} AND version = ${expectedVersion}
    RETURNING version`;
  if (rows && rows.length > 0) return { version: Number(rows[0].version) };
  // No row matched: either a newer version won the race, or the row is gone.
  const cur = await db`SELECT version FROM fintrack_store WHERE key = ${STORE_KEY}`;
  throw new VersionConflictError(cur && cur[0] ? Number(cur[0].version) : null);
}
