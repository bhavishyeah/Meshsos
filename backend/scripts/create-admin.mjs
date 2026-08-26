/**
 * One-off administrator bootstrap script.
 *
 * Reads configuration from the environment so no secrets are hard-coded:
 *   DATABASE_URL   - Postgres connection string (use Railway's PUBLIC url from a laptop)
 *   ADMIN_NAME     - display name
 *   ADMIN_EMAIL    - login email (unique)
 *   ADMIN_PASSWORD - plaintext password, hashed with bcrypt cost 12 before storage
 *
 * Safe to re-run: upserts on email.
 */

import bcrypt from 'bcrypt';
import pg from 'pg';

const { DATABASE_URL, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

const missing = ['DATABASE_URL', 'ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter(
  (key) => !process.env[key]
);

if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const result = await pool.query(
    `INSERT INTO users (role, name, email, password_hash)
     VALUES ('administrator', $1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET role = 'administrator',
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash
     RETURNING id, name, email, role`,
    [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
  );

  console.log('Administrator account ready:');
  console.table(result.rows);
} catch (error) {
  console.error('Failed to create administrator:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
