# ADR 0004: 다중 쓰기별 트랜잭션 패턴 선택 기준

- 상태: 승인됨
- 날짜: 2025-12-17 (표는 2026-07-22 `CLAUDE.md`에서 공식화)
- English: [0004-transaction-pattern-selection.md](0004-transaction-pattern-selection.md)

## 맥락

`FileService.uploadFile`은 `FileEntity` 행을 insert하고 **동시에** 업로드된 파일을
물리적으로 rename해야 하며, 둘은 함께 성공하거나 함께 실패해야 합니다. TypeORM에는
세 가지 실행 가능한 형태가 있습니다: 평범한 리포지토리 호출(자동 커밋),
`dataSource.transaction(callback)`(TypeORM이 수명주기 관리), 수동 QueryRunner
(개발자가 전 단계 관리). `@Transaction()` 데코레이터는 TypeORM 0.3에서 제거되어
선택지가 아닙니다.

## 결정

패턴 선택은 설계 시점 결정이며, 핸들러별로 다음 표에서 고릅니다:

| 패턴 | 수명주기 | 적용 대상 | 프로젝트 상태 |
|---|---|---|---|
| 평범한 리포지토리 호출 | TypeORM 암묵 (자동 커밋) | 단일 쓰기, 부수효과 없음 | 기본값 — `UserService`, `FileService.deleteFile` |
| 수동 QueryRunner | 개발자 관리, `release()`는 `finally` | 다중 쓰기 **+ 트랜잭션 경계 안의 비-DB 부수효과**(파일 rename) | 확립됨 — `FileService.uploadFile` / `updateFile` |
| `dataSource.transaction(cb)` | TypeORM이 begin/commit/rollback/release 관리 | 순수 다중 DB 쓰기, 부수효과 없음 | 허용; 현재 사용처 없음 — 새 순수 DB 사례에 권장 (release 누락 불가능) |
| `@Transaction()` 데코레이터 | — | — | **금지** (TypeORM 0.3에서 제거) |

(2026-07-30: **프로젝트 상태** 열은 결정 시점의 스냅샷이며 최신 색인이 아닙니다 —
권위 있는 표는 `CLAUDE.md` > Transaction Boundary입니다. `dataSource.transaction(cb)`은
더 이상 미사용이 아닙니다: `UserService.updateRole`이 채택했고([ADR 0013](0013-rbac-and-audit-log.ko.md)),
`UserService.remove`가 계정 연쇄 삭제에 사용합니다([ADR 0020](0020-account-deletion-cascade.ko.md)).
아래의 *선택 기준* 자체는 그대로입니다.)

rename은 `commitTransaction` *앞에* 둡니다 — DB와 파일시스템이 어긋날 수 있는 구간을
이 설계에서 가장 작게 만드는 배치입니다: rename이 실패하면 insert가 롤백되고, rename
성공 후 커밋이 실패하는 경우에만 어긋남이 생길 수 있습니다. 삭제는 반대입니다: `unlink`는
롤백이 없으므로 커밋 *이후에* 실행하며, 유일한 실패 결과는 복구 가능한 디스크 고아 파일입니다
([ADR 0020](0020-account-deletion-cascade.ko.md)).

## 결과

- `release()`는 항상 `finally`에, rollback은 `catch`에 두고, 외부 노출 에러는
  generic(`"Transaction aborted."`)을 유지합니다 — 내부 상세는 유출되지 않습니다.
- 새 다중 쓰기 핸들러는 구현 전에 패턴 선택과 근거를 명시합니다
  (`CLAUDE.md`의 Clarification Protocol로 강제).
- 수동 QueryRunner는 *예외*이며 트랜잭션 내 부수효과로만 정당화됩니다. 이를 순수 DB
  코드에 복사하면 피할 수 있는 수명주기 위험이 다시 생깁니다.
