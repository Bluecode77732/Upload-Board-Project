# ADR 0013: 역할 기반 접근 제어와 감사 로그

- 상태: 승인됨
- 날짜: 2026-07-25
- English: [0013-rbac-and-audit-log.md](0013-rbac-and-audit-log.md)

## 배경

지금까지 인증된 사용자는 모두 동등했다: 쓰기는 소유권 검사
([ADR 0007](0007-ownership-checks-without-rbac.ko.md))로만 보호됐다 — 계정은
본인만, 파일은 작성자만. 관리자 개념이 없어 누구도 타인의 콘텐츠를 관리할 수
없었고, 프론트엔드의 `/admin` 라우트 구역([ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md))은
기댈 백엔드가 없었다. RBAC은 결정된 로드맵 항목(Stage 0)으로, 마이그레이션
도입([ADR 0006](0006-schema-policy-and-migration-adoption.ko.md))으로 선행 조건이
풀렸고 API 표면을 먼저 동결하기 위해 Stage F 뒤로 유예됐다.

## 결정

- **문자열 enum 3단계 역할** — `user | admin | superadmin`
  (`backend/auth/role/role.ts`), `UserEntity.role`에 `varchar`로 저장(기본
  `'user'`). `ROLE_RANK` 맵이 순위를 부여해 상위 역할이 하위 요구를 충족한다.
  정수가 아닌 문자열 값이라 DB 컬럼과 Swagger가 읽기 쉽다.
- **RolesGuard + @Roles** — NestJS 관용 조합. `@Roles(UserRole.admin)`이 핸들러를
  표시하고, `RolesGuard`가 `request.user.role`의 순위를 요구치와 비교한다. 표시
  없는 핸들러는 통과(가드가 아무 제약도 걸지 않음)하므로 `JwtAuthGuard`와
  합성되면서 모든 라우트에 역할을 강제하지 않는다.
- **소유권을 "본인 또는 admin"으로 확장** — ADR 0007 검사가 이제 행위자가
  admin 이상일 때도 통과한다. 계정 본인 검사는 컨트롤러에, 파일 작성자 검사는
  서비스(`canManage`)에 그대로 둔다. 신원·역할은 새 `@AuthUser` 데코레이터
  (`{ id, role }`)로 JWT에서 오며, 절대 body에서 오지 않는다.
- **역할 부여는 superadmin 전용** — `PATCH /user/:id/role`. 변경은 `SERIALIZABLE`
  트랜잭션 + 행 잠금으로 실행되며 **마지막 superadmin 강등을 거부**
  (`AUTH_LAST_SUPERADMIN`)해 역할 체계가 스스로 잠기지 않게 한다. 모든 역할
  변경은 **대상자의 refresh 세션도 무효화**(`refreshTokenHash = null`,
  [ADR 0012](0012-refresh-cookie-rotation.ko.md))해 강등이 다음 액세스 토큰까지
  기다리지 않고 즉시 완전히 반영되게 한다.
- **superadmin 관리 = 상주 + 강등 경로** — superadmin은 상호·자가 강등이
  가능하다(마지막 1명 제외). 방치된 고권한 계정은 삭제가 아니라 강등으로
  정리한다. 계정 TTL/자동 만료는 기각: 역할 체계를 데드락시키고, 이 저장소에
  없는 스케줄러가 필요하며, 시드와 충돌한다. 유휴 계정은 세션 만료로 이미
  무력화되고, 모든 역할 변경은 감사된다.
- **감사 로그** — append-only `audit_log_entity`(`actorId`, `targetId`, `action`,
  `detail`, `createdAt`)가 `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`를
  기록한다. **외래 키가 없다** — 사용자를 하드 삭제해도 그 삭제 기록이 함께
  cascade되면 안 되기 때문이다. 쓰기는 주 트랜잭션이 커밋된 *뒤*에 일어난다
  (부수효과 격리: 로그 실패가 작업을 롤백하지 않는다). `GET /audit-log`(admin)는
  `(action, createdAt)` 인덱스로 페이지네이션된다.
- **최초 superadmin은 env 시드** — `SuperadminSeedService`가 부팅 시
  `SUPERADMIN_EMAIL` 계정을 승격한다(미설정이거나 이미 승격됐으면 무동작). 계정을
  먼저 등록해야 하며, 다음 부팅에 승격된다. 새 인프라도, 수동 SQL도 없다.

## 기각한 대안

- **superadmin 계정 TTL / 자동 만료** — 데드락(승격할 주체가 사라짐), 스케줄러
  필요(새 의존성, Scope Discipline), 부팅 시드와 충돌. "방치된 고권한 계정" 우려는
  세션 만료 + 감사로 이미 커버된다.
- **superadmin 전면 불변** — 앱 내 실수에는 가장 안전하나, 방치된 superadmin을
  앱 안에서 정리할 경로가 없다(DB/env로만). 모델 ①(마지막 1명 방지)은 잠금 위험
  없이 강등 경로를 남긴다.
- **정수 role enum**(Chat-project 방식) — 순위 비교는 싸지만 DB 컬럼과 Swagger가
  불투명한 숫자로 읽힌다; 문자열 값은 그 자체로 설명된다.
- **숫자/비트마스크 권한** — 시기상조; 순서 있는 3단계로 현 요구를 모두 충족한다.

## 결과

- `UserEntity.role`은 서버 통제 대상이다: `UpdateUserDto`에 `role` 필드가 없어
  전역 whitelist 파이프가 클라이언트의 설정 시도를 제거한다 — 역할 변경은
  superadmin 엔드포인트로만.
- 새 스로우 지점은 ADR 0011 계약에 따라 에러 코드를 싣는다(`FORBIDDEN`,
  `FORBIDDEN_NOT_OWNER`, `AUTH_LAST_SUPERADMIN`).
- ADR 0007의 소유권 검사는 대체된 것이 아니라 RBAC *아래에 얹혔다* — 그곳의
  "향후 RBAC 가드가 배치를 통일해야 한다"는 메모는 `@AuthUser` + `canManage`로
  해소됐다.
- Stage 0 완료. 역할 체계는 프론트엔드 `/admin` 구역을 받칠 준비가 됐다. admin의
  별도 앱 승격은 ADR 0010의 향후 결정으로 남는다.

> **2026-07-30 추가 메모** — 위 항목이 미뤄둔 질문은
> [ADR 0022](0022-admin-console-import-from-chat-project.ko.md)가 답한다: admin은 `admin/`의
> 전용 앱이 되며, 새로 작성하는 대신 저자의 Chat Project(이 3단계 계층을 똑같이 구현한
> 프로젝트)에서 가져왔다. **이 결정은 이 ADR의 내용을 아무것도 바꾸지 않는다** — 역할, guard,
> 엔드포인트, 감사 동작에 영향이 없다. 여기 적는 이유는 하나뿐이다: 이 ADR이 의도적으로 만들지
> 않은 운영 화면의 담당자가 정해졌기 때문이다 — 역할 목록 조회, `PATCH /user/:id/role`을 통한
> 승격·강등, `ROLE_CHANGE` 감사 행 열람. 그 이식본이 적응되기 전까지 계층은 Swagger나 직접
> 요청으로**만** 운영 가능하며, 여기서 정의한 두 불변식 — 마지막 superadmin 강등 거부
> (`AUTH_LAST_SUPERADMIN`)와 모든 역할 변경 시의 세션 종료 — 은 그것을 실행하는 사람에게
> 보이지 않는 상태로 남는다. ADR 0022는 둘 다 UI가 반드시 드러내야 할 동작으로 기록해 뒀다.
