// Purpose: TypeORM CLI DataSource for migration generate/run/revert outside the Nest container.
// Usage: referenced by the package.json migration:* scripts via -d dist/data-source.js; never imported by app code (AppModule keeps its own TypeOrmModule config).
// Rationale: ConfigService exists only inside the Nest DI container, so this file is the one sanctioned place env vars are read directly (documented exception to CLAUDE.md > Environment Variables).

import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

try {
  // Node >= 20.12 built-in .env loader — avoids a dotenv dependency.
  process.loadEnvFile();
} catch {
  // .env is optional here: CI/production may supply real environment variables.
}

// Mirrors the Joi fail-fast behavior of app.module.ts for the CLI context.
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

// 목적: migration:* 스크립트가 쓰는 CLI DataSource를 구성한다.
// 이유: app.module.ts의 DB_SSL과 같은 이유 — TLS를 강제하는 DB(RDS 등)에
//       평문으로 붙으면 마이그레이션이 인증 단계 전에 거부당한다.
// 방법: app.module.ts와 동일한 boolean 스위치를 process.env에서 직접 읽는다
//       (이 파일은 ConfigService 밖이라 원래도 process.env 직접 접근이 허용된 예외).
export default new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(required('DB_PORT')),
  username: required('DB_USERNAME'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Shared with app.module.ts: generate diffs against exactly what the app registers,
  // so an entity can never be live in the app but invisible to the migration CLI.
  entities: ENTITIES,
  // __dirname-relative so the compiled dist/data-source.js finds dist/migrations/*.js.
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
});
