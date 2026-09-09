// 목적: Nest 컨테이너 밖에서 migration generate/run/revert에 쓰는 TypeORM CLI DataSource다.
// 사용처: package.json의 migration:* 스크립트가 -d dist/data-source.js로 참조한다; 앱 코드에서는 절대 임포트하지 않는다(AppModule은 자체 TypeOrmModule 설정을 갖는다).
// 근거: ConfigService는 Nest DI 컨테이너 안에서만 존재하므로, 이 파일이 env var를 직접 읽는 게 허용된 유일한 곳이다(CLAUDE.md > Environment Variables에 문서화된 예외).

import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

try {
  // Node >= 20.12에 내장된 .env 로더다 — dotenv 의존성이 필요 없다.
  process.loadEnvFile();
} catch {
  // 여기서 .env는 선택 사항이다: CI/production은 실제 환경 변수를 별도로 제공할 수 있다.
}

// CLI 맥락에서 app.module.ts의 Joi fail-fast 동작을 그대로 흉내 낸다.
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

// 목적: migration:* 스크립트가 쓰는 CLI DataSource를 구성한다.
// 이유: app.module.ts의 DB_SSL/DB_SSL_CA와 같은 이유(ADR 0039) — TLS를 강제하는
//       DB(RDS 등)에 평문으로 붙으면 마이그레이션이 인증 단계 전에 거부당한다.
// 방법: app.module.ts와 동일하게 DB_SSL_CA(CA 인증서 PEM)로 실제 인증서 검증을
//       켠다 — rejectUnauthorized: false로 검증을 끄지 않는다. 이 파일은
//       ConfigService 밖이라 원래도 process.env 직접 접근이 허용된 예외.
export default new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(required('DB_PORT')),
  username: required('DB_USERNAME'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE'),
  ssl: process.env.DB_SSL === 'true' ? { ca: required('DB_SSL_CA') } : false,
  // app.module.ts와 공유한다: generate가 앱이 등록한 것과 정확히 같은 대상을 놓고 diff를 뜨므로,
  // 어떤 엔티티도 앱에는 살아있으면서 migration CLI에는 보이지 않는 일이 없다.
  entities: ENTITIES,
  // __dirname 기준 상대경로라, 컴파일된 dist/data-source.js가 dist/migrations/*.js를 찾을 수 있다.
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
});
