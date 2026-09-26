// Neon Postgres backing store for FinTrack.
// Uses a single-row JSON document (`fintrack_store.key='main'`) so the entire
// existing ledger logic in server.js works unchanged on Vercel serverless,
// where the filesystem is ephemeral. Data lives in Neon, not in data/*.json.
import { neon } from '@neondatabase/serverless';

export const isNeon = !!process.env.DATABASE_URL;
const STORE_KEY = 'main';

let sql = null;
function client() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

export async function initNeonSchema() {
  if (!isNeon) return;
  const db = client();
  await db`CREATE TABLE IF NOT EXISTS fintrack_store (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export async function loadFromNeon(fallbackEmpty) {
  const db = client();
  await initNeonSchema();
  const rows = await db`SELECT data FROM fintrack_store WHERE key = ${STORE_KEY}`;
  if (!rows || rows.length === 0) {
    const empty = fallbackEmpty();
    await db`INSERT INTO fintrack_store (key, data) VALUES (${STORE_KEY}, ${JSON.stringify(empty)}) ON CONFLICT (key) DO NOTHING`;
    return empty;
  }
  const data = rows[0].data;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function saveToNeon(dbData) {
  const db = client();
  await db`INSERT INTO fintrack_store (key, data, updated_at)
    VALUES (${STORE_KEY}, ${JSON.stringify(dbData)}, NOW())
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
}
