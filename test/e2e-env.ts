// 목적: 어떤 스펙이든 AppModule을 임포트하기 전에, 앱이 일회용 테스트 DB를 보도록 미리 돌려놓는다.
// 사용처: test/jest-e2e.json에 jest `setupFiles`로 연결되어, 테스트 모듈 그래프가 로드되기 전 워커당 한 번 실행된다.
// 이유: ConfigModule.forRoot()가 AppModule 임포트 시점에 DB_DATABASE를 스냅샷 뜬다 — beforeAll에서 설정하면 이미 늦어서, 마이그레이션이 일회용 DB를 채우는 동안 앱은 진짜 DB(예: `postgres`)에 붙어 모든 쿼리가 없는 테이블에 부딪히게 된다.

try {
  // Local runs: load .env for DB host/port/secrets. In CI there is no .env and the
  // workflow supplies these directly, so the throw is expected and ignored.
  process.loadEnvFile();
} catch {
  // No .env present — env comes from the real process environment.
}

// The suite owns a throwaway database (dropped/recreated per run). This must run
// before AppModule is imported; e2e-utils reads this same value back for TEST_DB_NAME.
process.env.DB_DATABASE = 'sharenpo_e2e';

// Keep the orphan temp-file sweep (ADR 0018) from registering its cron during e2e:
// the tests exercise the two-phase upload directly and never need the background sweep.
process.env.TEMP_SWEEP_ENABLED = 'false';

// Same reason, for the granted-file reclaim sweep (ADR 0051): e2e boots a real DB and
// must not race a background cron against its own fixtures.
process.env.GRANTED_SWEEP_ENABLED = 'false';
