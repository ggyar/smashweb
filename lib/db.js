// Datenbank-Zugriff (PostgreSQL über DATABASE_URL). DATABASE_URL=memory nutzt pg-mem (nur für Tests).
const SCHEMA = require('./schema');

const MEMORY = process.env.DATABASE_URL === 'memory';

// node-postgres kennt "channel_binding" aus Neon-URLs nicht -> entfernen (die Verbindung bleibt per SSL verschlüsselt)
const cleanUrl = (u) => String(u).trim().replace(/([?&])channel_binding=[^&]*&?/i, '$1').replace(/[?&]$/, '');
let pool = null;
let migrated = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    const e = new Error('DATABASE_URL ist nicht gesetzt.');
    e.code = 'NO_DB';
    throw e;
  }
  if (MEMORY) {
    const { newDb } = require('pg-mem');
    const { Pool } = newDb().adapters.createPg();
    pool = new Pool();
  } else {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: cleanUrl(process.env.DATABASE_URL),
      max: process.env.VERCEL ? 1 : 8,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
    });
    pool.on('error', () => {});
  }
  return pool;
}

function migrate() {
  if (!migrated) {
    migrated = getPool().query(SCHEMA).catch((e) => { migrated = null; throw e; });
  }
  return migrated;
}

async function query(sql, params) {
  await migrate();
  return getPool().query(sql, params);
}

// Transaktion; die Aufrufer sperren die Turnierzeile mit lockClause (verhindert gleichzeitige Änderungen).
async function tx(fn) {
  await migrate();
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignorieren */ }
    throw e;
  } finally {
    c.release();
  }
}

const lockClause = MEMORY ? '' : ' FOR UPDATE';
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

module.exports = { query, tx, lockClause, json };
