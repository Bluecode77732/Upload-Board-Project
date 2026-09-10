// 목적: 어떤 스펙이든 AppModule을 임포트하기 전에, 앱이 일회용 테스트 DB를 보도록 미리 돌려놓는다.
// 사용처: test/jest-e2e.json에 jest `setupFiles`로 연결되어, 테스트 모듈 그래프가 로드되기 전 워커당 한 번 실행된다.
// 이유: ConfigModule.forRoot()가 AppModule 임포트 시점에 DB_DATABASE를 스냅샷 뜬다 — beforeAll에서 설정하면 이미 늦어서, 마이그레이션이 일회용 DB를 채우는 동안 앱은 진짜 DB(예: `postgres`)에 붙어 모든 쿼리가 없는 테이블에 부딪히게 된다.

try {
  // 로컬 실행: DB 호스트/포트/시크릿을 위해 .env를 로드한다. CI에는 .env가 없고
  // 워크플로가 이 값들을 직접 공급하므로, 이 throw는 예상된 것이고 무시한다.
  process.loadEnvFile();
} catch {
  // .env가 없다 — env는 실제 프로세스 환경에서 온다.
}

// 스위트는 일회용 데이터베이스를 소유한다(실행마다 drop/recreate). AppModule이
// 임포트되기 전에 반드시 실행돼야 한다; e2e-utils가 같은 값을 TEST_DB_NAME으로 다시 읽는다.
process.env.DB_DATABASE = 'sharenpo_e2e';

// e2e 동안 고아 temp 파일 스윕(ADR 0018)이 자신의 cron을 등록하지 않게 막는다:
// 테스트는 2단계 업로드를 직접 다루므로 백그라운드 스윕이 전혀 필요 없다.
process.env.TEMP_SWEEP_ENABLED = 'false';

// granted 파일 회수 스윕(ADR 0051)도 같은 이유다: e2e는 실제 DB를 띄우므로
// 백그라운드 cron이 자기 자신의 픽스처와 경합하면 안 된다.
process.env.GRANTED_SWEEP_ENABLED = 'false';

// 전역 요청 횟수 제한(ADR 0053)도 꺼둔다: 이 스위트는 같은 서버 인스턴스에 순차로
// 수백 건의 HTTP 요청을 보내고, supertest의 인프로세스 요청은 전부 같은 클라이언트 IP로
// 잡혀 하나의 카운터를 공유하므로 분당 100회 기본값에 금방 걸려 429로 스위트가 깨진다.
process.env.THROTTLE_ENABLED = 'false';
