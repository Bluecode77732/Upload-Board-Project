# ADR 0006: `synchronize: false` + 수동 스키마, 마이그레이션 도입 예정

- 상태: 승인됨 — 2026-07-22 구현 완료
- 날짜: 2026-07-22 (`synchronize: false` 커밋은 2026-04-14)
- English: [0006-schema-policy-and-migration-adoption.md](0006-schema-policy-and-migration-adoption.md)

## 맥락

초기 개발은 `synchronize: true`로 진행됐습니다 — TypeORM이 부팅 시 스키마를 자동
변경합니다. 실제 데이터가 존재하는 순간 이는 데이터 손실 위험입니다(컬럼 이름 변경이
drop + add가 됨). 플래그는 2026-04-14(커밋 `2f2fc99`)에 `false`로 바뀌었지만,
마이그레이션 도구가 그 자리를 대체하지 않아 스키마 변경에 관리된 경로가 없는 상태가
되었습니다.

## 결정

- `synchronize: false`는 커밋되어 있으며 그대로 유지됩니다.
- **TypeORM 마이그레이션을 도입합니다**(`migration:generate`/`migration:run` 스크립트
  + `backend/migrations/`) — 전용 로드맵 작업으로 진행하며, 다른 변경의 부수효과로
  부트스트랩하지 않습니다.
- 그 작업이 완료되기 전까지 스키마는 수동으로 적용합니다(로컬 개발 환경에서
  `synchronize`를 일시적으로 켜는 것은 마이그레이션 도입과 함께 사라질 과도기
  지침입니다).
- 마이그레이션이 생기면: 엔티티 변경 요청은 먼저 평문으로 기술하고,
  `migration:generate` 출력은 실행 전에 항상 줄 단위로 검토합니다.
- 엔티티는 `app.module.ts`에 명시적으로 등록(`entities: [...]`)을 유지하며
  `autoLoadEntities: true`와 함께 갑니다 — 엔티티 추가 시 둘을 동기화합니다.

## 결과

- 어떤 환경도 프로덕션 형태의 스키마를 조용히 변경할 수 없습니다.
- 수동 기간에는 실질 비용이 있었습니다: 마이그레이션 도입 전까지 엔티티 수정과 DB
  상태가 어긋날 수 있었습니다 — 마이그레이션은 도입되었고(2026-07-22; 이 ADR이 그
  도입을 기록) 이제 그 기간은 닫혔습니다 ([ROADMAP.ko.md](../ROADMAP.ko.md)).
- `CLAUDE.md` Scope Discipline은 `migration:generate`를 부수 작업으로 실행하는 것을
  금지합니다. 스키마 변경은 항상 평문으로 기술하고 먼저 승인받습니다.

## 구현 노트 (2026-07-22)

설계대로 도입했으며, 구체 사항은 다음과 같습니다:

- CLI DataSource: `backend/data-source.ts`를 컴파일된 `dist/` 출력으로 실행
  (`typeorm ... -d dist/data-source.js`; 각 `migration:*` 스크립트가 먼저 빌드).
  Nest의 `ConfigService`는 DI 컨테이너 밖에 존재하지 않으므로, 이 파일이 환경변수를
  직접 읽는 유일하게 공인된 위치입니다. 환경 로딩은 Node 내장
  `process.loadEnvFile()`을 사용합니다(dotenv 의존성 없음).
- 베이스라인: `backend/migrations/1784678400000-InitialSchema.ts`가 기존 수동 스키마를
  담습니다. 새 데이터베이스 → `pnpm migration:run`. 수동 시대 스키마를 이미 가진
  데이터베이스 → `pnpm migration:run -- --fake`를 한 번 실행해 테이블 재생성 없이
  베이스라인을 적용 완료로 표시합니다.
- 베이스라인은 TypeORM의 해시 기본값 대신 읽기 쉬운 제약 이름을 사용합니다. 이후
  `migration:generate` 출력이 불필요한 제약 이름 변경을 제안할 수 있습니다 —
  필수인 줄 단위 검토에서 그 부분을 제거하세요.
