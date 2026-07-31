// Purpose: boots a real HTTP+DB Nest app against a throwaway, migration-built database so e2e specs verify full request→response paths in isolation.
// Usage: imported by *.e2e-spec.ts — setupE2E() in beforeAll, teardownE2E() in afterAll, truncateAll() in beforeEach; plus Basic-auth/cookie helpers.
// Rationale: main.ts (global ValidationPipe + cookie-parser) is not applied by Test.createTestingModule, and the dev DB must not be polluted — this centralizes both, and the isolation strategy (dedicated DB + per-test truncate), in one place.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import { AppModule } from '../backend/app.module';
import { InitialSchema1784678400000 } from '../backend/migrations/1784678400000-InitialSchema';
import { AddUserRefreshTokenHash1784851200000 } from '../backend/migrations/1784851200000-AddUserRefreshTokenHash';
import { AddUserRoleAndAuditLog1784912790431 } from '../backend/migrations/1784912790431-AddUserRoleAndAuditLog';
import { AddPostEntity1785428640007 } from '../backend/migrations/1785428640007-AddPostEntity';
import { AddCommentEntity1785476002527 } from '../backend/migrations/1785476002527-AddCommentEntity';

// A dedicated database, never the dev one — dropped and recreated every run so the
// suite owns its data. New migrations must be appended here or boot fails loudly.
// The name is set by test/e2e-env.ts before AppModule is imported (so ConfigModule
// captures it); reading it back here keeps a single source of truth.
const TEST_DB_NAME = process.env.DB_DATABASE ?? 'upload_board_e2e';
const MIGRATIONS = [
  InitialSchema1784678400000,
  AddUserRefreshTokenHash1784851200000,
  AddUserRoleAndAuditLog1784912790431,
  AddPostEntity1785428640007,
  AddCommentEntity1785476002527,
];

// Every table the app writes; truncated between tests for per-test isolation.
const TABLES = [
  'user_entity',
  'file_entity',
  'audit_log_entity',
  'post_entity',
  'comment_entity',
];

function connectionBase() {
  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    synchronize: false,
  };
}

// Drop + create the throwaway DB via a maintenance connection to the default
// `postgres` database. WITH (FORCE) evicts any lingering connection (PostgreSQL 16+).
async function recreateTestDatabase(): Promise<void> {
  const admin = new DataSource({ ...connectionBase(), database: 'postgres' });
  await admin.initialize();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.destroy();
  }
}

// Build the schema by running the real migrations — the faithful path (validates
// the migrations too), never synchronize:true (Never Do Group 2).
async function runMigrations(): Promise<void> {
  const migrator = new DataSource({
    ...connectionBase(),
    database: TEST_DB_NAME,
    migrations: MIGRATIONS,
  });
  await migrator.initialize();
  try {
    await migrator.runMigrations();
  } finally {
    await migrator.destroy();
  }
}

// Replicates main.ts bootstrap (cookie-parser + the global ValidationPipe) — neither
// is applied by Test.createTestingModule, but both are load-bearing for the e2e paths.
async function bootstrapTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

export async function setupE2E(): Promise<INestApplication> {
  // Env (incl. the DB_DATABASE override) is set by test/e2e-env.ts before AppModule
  // is imported — see that file's rationale.
  await recreateTestDatabase();
  await runMigrations();
  return bootstrapTestApp();
}

export async function teardownE2E(app: INestApplication): Promise<void> {
  await app.close();
  const admin = new DataSource({ ...connectionBase(), database: 'postgres' });
  await admin.initialize();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
  } finally {
    await admin.destroy();
  }
}

export async function truncateAll(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const quoted = TABLES.map((t) => `"${t}"`).join(', ');
  await dataSource.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}

// Basic-token auth header value for /auth/register and /auth/signin.
export function basic(email: string, password: string): string {
  const encoded = Buffer.from(`${email}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

// Pull the refreshToken cookie (name=value only) out of a Set-Cookie response so it
// can be replayed via .set('Cookie', ...) — supertest keeps no cookie jar across calls.
export function refreshCookieFrom(res: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const refresh = cookies.find((c) => c.startsWith('refreshToken='));
  if (!refresh) {
    throw new Error('No refreshToken cookie in response.');
  }
  return refresh.split(';')[0];
}
