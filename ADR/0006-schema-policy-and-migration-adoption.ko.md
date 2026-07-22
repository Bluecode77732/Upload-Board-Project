# ADR 0006: `synchronize: false` + 수동 스키마, 마이그레이션 도입 예정

- 상태: 승인됨
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
  + `src/migrations/`) — 전용 로드맵 작업으로서이며, 다른 변경의 부수효과로
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
- 수동 기간에는 실질 비용이 있습니다: 마이그레이션 도입 전까지 엔티티 수정과 DB
  상태가 어긋날 수 있습니다 — 이것이 최우선 로드맵 항목입니다
  ([ROADMAP.ko.md](../ROADMAP.ko.md)).
- `CLAUDE.md` Scope Discipline은 `migration:generate`를 부수 작업으로 실행하는 것을
  금지합니다. 스키마 변경은 항상 평문으로 기술하고 먼저 승인받습니다.
