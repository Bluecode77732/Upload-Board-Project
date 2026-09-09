// 목적: admin e2e 테스트용 superadmin 계정을 생성/갱신한다 — in-app 플로우로는 만들 수
// 없다 (실제 생성 메커니즘은 SUPERADMIN_EMAIL + `pnpm promote-superadmin`, backend
// ADR 0013/ADR 0052 — 이 저장소 어디에도 "Role Population Invariants" 같은 절은 없다).
// 사용처: 저장소 루트에서 `pnpm --filter admin e2e` 실행 전에 `pnpm --filter admin
// e2e:seed`로 실행한다. 로컬(e2e/.env 읽음)과 CI(job 레벨 env를 직접 읽음) 모두 해당.
// 근거: 로컬 개발과 CI가 공유하므로 시딩 로직이 정확히 한 곳에만 존재한다.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 두 파일 모두 로컬 실행에서만 존재한다 — CI는 DB_*와 E2E_SUPERADMIN_*을 job env
// 변수로 직접 제공하므로 CI에서는 이 루프가 아무 일도 하지 않는다.
// 루트 .env(backend/.env가 아니다 — 그런 파일은 없다)는 저장소 루트에서 이 스크립트를
// 실행할 때 백엔드의 DB_* 변수를 담고 있다.
for (const envFile of ['../.env', './e2e/.env']) {
    try {
        process.loadEnvFile(envFile);
    } catch {
        // 파일이 없는 것 — 위 설명대로 정상이다
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
// backend 자체 의존성 트리가 하는 방식 그대로 bcrypt/pg를 resolve한다 — 이 스크립트는
// 자체 의존성이 없고, 실행 중인 backend가 이미 필요로 하는 것들을 그대로 재사용한다.
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
        `INSERT INTO user_entity (email, password, role)
         VALUES ($1, $2, 'superadmin')
         ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role`,
        [email, hash],
    );
    console.log(`Seeded superadmin: ${email}`);
} finally {
    await client.end();
}
