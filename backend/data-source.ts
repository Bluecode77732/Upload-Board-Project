// Purpose: TypeORM CLI DataSource for migration generate/run/revert outside the Nest container.
// Usage: referenced by the package.json migration:* scripts via -d dist/data-source.js; never imported by app code (AppModule keeps its own TypeOrmModule config).
// Rationale: ConfigService exists only inside the Nest DI container, so this file is the one sanctioned place env vars are read directly (documented exception to CLAUDE.md > Environment Variables).

import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { FileEntity } from './file/entity/file.entity';
import { UserEntity } from './user/entity/user.entity';
import { AuditLogEntity } from './audit-log/audit-log.entity';

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

export default new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(required('DB_PORT')),
  username: required('DB_USERNAME'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE'),
  entities: [FileEntity, UserEntity, AuditLogEntity],
  // __dirname-relative so the compiled dist/data-source.js finds dist/migrations/*.js.
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
});
