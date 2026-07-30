// Purpose: seeds/updates a superadmin account for admin e2e tests — no in-app flow
// can create one (see CLAUDE.md's Role Population Invariants).
// Usage: run from the repo root as `pnpm --filter admin e2e:seed` before `pnpm --filter
// admin e2e`, both locally (reads e2e/.env) and in CI (reads job-level env directly).
// Rationale: shared by local dev and CI so the seeding logic exists exactly once.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Both files are only present for local runs — CI supplies DB_* and
// E2E_SUPERADMIN_* directly as job env vars, so these are no-ops there.
for (const envFile of ['../backend/.env', './e2e/.env']) {
    try {
        process.loadEnvFile(envFile);
    } catch {
        // missing file — fine, see above
    }
}

const email = process.env.E2E_SUPERADMIN_EMAIL;
const password = process.env.E2E_SUPERADMIN_PASSWORD;
if (!email || !password) {
    throw new Error(
        'E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD are not set — copy e2e/.env.example to e2e/.env and fill in a superadmin account.',
    );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve bcrypt/pg as backend's own dependency tree would — this script has no
// dependencies of its own, it reuses the ones the running backend already needs.
const backendRequire = createRequire(join(__dirname, '../../backend/'));
const bcrypt = backendRequire('bcrypt');
const { Client } = backendRequire('pg');

const hash = await bcrypt.hash(password, 10);

const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE ?? 'postgres',
});
await client.connect();
try {
    await client.query(
        `INSERT INTO user_entity (email, password, role, "isAI")
         VALUES ($1, $2, 2, false)
         ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role`,
        [email, hash],
    );
    console.log(`Seeded superadmin: ${email}`);
} finally {
    await client.end();
}
