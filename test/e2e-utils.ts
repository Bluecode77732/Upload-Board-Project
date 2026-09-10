// 목적: 실제 HTTP+DB Nest 앱을 마이그레이션으로 만든 일회용 DB 위에 띄워, e2e 스펙이
// 요청→응답 전체 경로를 격리된 환경에서 검증할 수 있게 한다.
// 사용처: *.e2e-spec.ts가 임포트한다 — beforeAll에서 setupE2E(), afterAll에서 teardownE2E(),
// beforeEach에서 truncateAll(); 그리고 Basic-auth/쿠키 헬퍼들.
// 근거: main.ts의 (전역 ValidationPipe + cookie-parser)는 Test.createTestingModule에는 적용되지
// 않고, dev DB를 오염시켜서도 안 된다 — 이 파일이 둘 다와 격리 전략(전용 DB + 테스트별 truncate)을
// 한 곳에 모은다.

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
import { AddFileVisibility1785571437643 } from '../backend/migrations/1785571437643-AddFileVisibility';
import { AddFileMediaType1786818802632 } from '../backend/migrations/1786818802632-AddFileMediaType';
import { AddAuditLogTargetType1787578451680 } from '../backend/migrations/1787578451680-AddAuditLogTargetType';
import { AddPerformanceIndexes1788180660994 } from '../backend/migrations/1788180660994-AddPerformanceIndexes';
import { AddFileTransferPending1788517947527 } from '../backend/migrations/1788517947527-AddFileTransferPending';

// dev DB가 아닌 전용 데이터베이스다 — 스위트가 자기 데이터를 소유하도록 실행마다
// drop 후 재생성한다. 새 마이그레이션은 반드시 여기에도 추가해야 하며, 안 그러면
// 부팅이 요란하게 실패한다. 이름은 AppModule이 임포트되기 전에 test/e2e-env.ts가
// 설정한다(ConfigModule이 그 값을 캡처하도록); 여기서 그 값을 다시 읽어 단일 진실
// 소스를 유지한다.
const TEST_DB_NAME = process.env.DB_DATABASE ?? 'sharenpo_e2e';
const MIGRATIONS = [
  InitialSchema1784678400000,
  AddUserRefreshTokenHash1784851200000,
  AddUserRoleAndAuditLog1784912790431,
  AddPostEntity1785428640007,
  AddCommentEntity1785476002527,
  AddFileVisibility1785571437643,
  AddFileMediaType1786818802632,
  AddAuditLogTargetType1787578451680,
  AddPerformanceIndexes1788180660994,
  AddFileTransferPending1788517947527,
];

// 앱이 쓰는 모든 테이블; 테스트별 격리를 위해 테스트 사이마다 truncate된다.
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

// 기본 `postgres` 데이터베이스에 대한 관리용 연결로 일회용 DB를 drop한 뒤 다시
// create한다. WITH (FORCE)는 남아 있는 연결을 강제로 끊어낸다(PostgreSQL 16+).
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

// 실제 마이그레이션을 실행해 스키마를 만든다 — 마이그레이션 자체도 검증하는 충실한
// 경로이며, synchronize:true는 절대 쓰지 않는다(Never Do Group 2).
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

// main.ts의 부트스트랩(cookie-parser + 전역 ValidationPipe)을 재현한다 — 둘 다
// Test.createTestingModule에는 적용되지 않지만, e2e 경로에는 둘 다 필수적이다.
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
  // env(DB_DATABASE 오버라이드 포함)는 AppModule이 임포트되기 전에
  // test/e2e-env.ts가 설정한다 — 그 파일의 근거 참고.
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

// /auth/register와 /auth/signin에 쓰이는 Basic 토큰 인증 헤더 값.
export function basic(email: string, password: string): string {
  const encoded = Buffer.from(`${email}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

// Set-Cookie 응답에서 refreshToken 쿠키(name=value만)를 뽑아내, .set('Cookie', ...)로
// 다시 재생할 수 있게 한다 — supertest는 호출 간 쿠키 저장소를 유지하지 않는다.
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
