/**
 * Database Migration Runner
 *
 * Runs SQL migration files in order from the migrations/ directory.
 * Tracks applied migrations in a `schema_migrations` table to avoid re-running.
 *
 * Usage:
 *   npx tsx src/db/migrate.ts
 *
 * Environment variables:
 *   DATABASE_URL - PostgreSQL connection string (e.g., postgres://user:pass@localhost:5432/meshsos)
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface MigrationRecord {
  name: string;
  applied_at: Date;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<MigrationRecord>(
    'SELECT name FROM schema_migrations ORDER BY id'
  );
  return new Set(result.rows.map((row) => row.name));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await fs.promises.readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Example: DATABASE_URL=postgres://user:pass@localhost:5432/meshsos');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const migrationFiles = await getMigrationFiles();

    const pending = migrationFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):\n`);

    for (const file of pending) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.promises.readFile(filePath, 'utf-8');

      console.log(`  Applying: ${file}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  Applied:  ${file} ✓`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAILED:   ${file} ✗`);
        throw err;
      }
    }

    console.log(`\nAll migrations applied successfully.`);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
