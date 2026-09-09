# ADR 0052: Superadmin 시딩을 수동 트리거로 전환

- Status: Accepted — implemented
- Date: 2026-09-09
- Amends: [ADR 0013](0013-rbac-and-audit-log.ko.md)
- English: [0052-superadmin-seed-manual-trigger.md](0052-superadmin-seed-manual-trigger.md)

## Context

[ADR 0013](0013-rbac-and-audit-log.ko.md)의 "First superadmin via env seed" 항목은
`SuperadminSeedService.onApplicationBootstrap()`(`backend/user/superadmin-seed.service.ts`)을
낳았다: 부팅 시마다 `SUPERADMIN_EMAIL`이 설정돼 있고 해당 이메일 계정이 존재하며 아직
`superadmin`이 아니라면 무조건 승격시킨다. ADR 0013은 새 인프라와 수동 SQL 단계를 피하기
위해 의도적으로 이 방식을 택했다.

2026-09-09 보안 점검에서 그 트레이드오프가 남긴 구멍이 발견됐다: 이 서비스는 해당 이메일
계정이 *존재하는지*만 확인할 뿐, 그 등록자가 진짜 소유자인지는 전혀 검증하지 않는다.
회원가입(`POST /auth/register`)은 누구에게나 열려 있다. 공격자가 실소유자보다 먼저
`SUPERADMIN_EMAIL`로 가입해버리면 — 가장 그럴듯한 시점은 새 배포(env var는 이미
설정됨) 직후부터 소유자가 처음 가입하기 전까지의 창(window) — 다음 부팅에서 아무 검증
없이 공격자 계정이 `superadmin`으로 승격된다.

이 프로젝트의 실제 제약(아직 실사용자 없음, SMTP 인프라 전무 — `package.json`과
`.env.example`에서 확인됨)을 놓고 세 가지 해결책을 검토했다:

1. "현재 superadmin이 0명일 때만" 승격 허용 — 기각. 원래 레이스가 발생하는 시점(새 배포
   직후, 소유자의 첫 가입 이전)엔 이미 superadmin이 0명이므로, 이 게이트는 정작 막으려던
   레이스를 막지 못한다. 더 좁고 발생 가능성 낮은 시나리오(원래 superadmin 계정 삭제 후
   같은 이메일 재등록)만 막을 뿐이다.
2. 승격 전 이메일 인증 도입 — 지금은 기각. 이 프로젝트엔 메일 발송 인프라가 전혀 없다 —
   SMTP 계정, 신규 의존성, 인증 토큰용 스키마 변경, 신규 엔드포인트, 신규 env var까지
   필요한, 범위가 한정된 수정이 아니라 사실상 신규 기능 하나이며 현재 단계에 걸맞지 않다.
3. 자동 승격을 제거하고 의도적인 수동 단계로 전환 — **채택**.

## Decision

### D1 — `SuperadminSeedService` 제거, 명시적 스크립트로 승격

`backend/user/superadmin-seed.service.ts`와 `UserModule` 등록을 삭제한다. 승격은 이제
`pnpm promote-superadmin` — 운영자가 해당 계정이 진짜 소유자의 것임을 직접 확인한 뒤에만
손으로 실행하는 독립 스크립트(`backend/scripts/promote-superadmin.ts`)를 통해 이뤄진다.
이것이 자동화된 신원 검증을 추가하는 것은 아니다 — "무조건적인 자동 신뢰"를 "승격 시점에
사람이 내리는 의도적인 판단"으로 대체하는 것이며, 그 판단을 내리는 운영자 자신이 검증
단계가 된다.

### D2 — `SUPERADMIN_EMAIL`은 그대로 스크립트의 입력값으로 남긴다

env var의 Joi 스키마 항목(`backend/app.module.ts`, 변경 없음 — 선택, 기본값 없음)과
`.env.example` 문서는 그대로 유지한다. 스크립트는 `backend/data-source.ts`가 이미 Nest DI
컨테이너 밖에서 DB 접속 env var를 읽는 것과 같은 방식으로 `SUPERADMIN_EMAIL`을 읽는다
(그 파일의 `process.loadEnvFile()` 부수효과는 스크립트가 그 파일의 default export인
`DataSource`를 import하는 시점에 실행된다). CLI 인자 방식 대신 이 방식을 택한 이유: 이번에
고치는 보안 속성은 "승격이 자동으로 일어나는가"이지 "대상 이메일을 어디에 설정하는가"가
아니다. env var를 유지하면 추가 보안 이득 없이 `app.module.ts`(Scope Discipline상
고위험 파일)를 한 번 더 건드릴 필요가 없고, 로컬/CI/Helm 설정 방식도 그대로 유지된다.

### D3 — `backend/data-source.ts`의 `DataSource`를 재사용, 두 번째 `process.env` 예외를
만들지 않는다

CLAUDE.md의 Config 절은 `backend/data-source.ts`를 `ConfigService` 밖에서 `process.env`를
직접 읽는 *유일한* 예외로 명시하며, 두 번째 예외를 만들지 말라고 못박는다.
`promote-superadmin.ts`는 그 파일이 default export하는 `DataSource`를 import해서 쓴다
(`initialize()` → `UserRepository.update()` 단일 쓰기 → `finally`에서 `destroy()`) —
스스로 `process.env`를 읽지 않으므로 두 번째 예외가 생기지 않는다.

## Consequences

- **정상 배포 시나리오에서 신원 검증 구멍이 닫힌다**: 사람이 직접 스크립트를 실행하고 그
  순간 소유권을 확인하지 않는 한 어떤 계정도 승격되지 않는다. *운영자*에 대한 신뢰
  모델 자체는 바뀌지 않는다(여전히 올바르게 실행할 것이라 신뢰한다) — 이 ADR은 암호학적
  또는 이메일 기반 신원 증명을 추가하지 않으며, 그렇다고 주장하지도 않는다.
- **`SuperadminSeedService`와 (존재하지 않았던) 그 spec 파일이 사라진다.** 엔티티/스키마
  변경 없음 — `UserEntity.role`과 그 기본값(`'user'`)은 그대로다.
- **새로운 운영 단계가 생긴다**: 새 환경을 구축할 때 운영자가 먼저 superadmin이 될 계정을
  가입시킨 뒤 `pnpm promote-superadmin`을 실행해야 한다. README.md/CLAUDE.md의 Commands
  절에 문서화했으며, 이 프로젝트가 이미 채택한 "런북에 적힌 1회성 수동 단계" 패턴(예:
  `k8s/infra/terraform/README.md`의 `SecretStore`/`ExternalSecret` 수동 `kubectl apply`
  단계)과 같은 결이다.
- **`admin/e2e/seed-superadmin.mjs`는 동작상 영향 없음** — 이 스크립트는 이미
  `SuperadminSeedService`와 무관하게 raw `pg` upsert로 테스트 계정을 직접 승격시키고
  있었다. 다만 지금은 삭제된 그 서비스를 "실제 생성 메커니즘"이라고 인용하던 헤더
  코멘트는 이 ADR과 새 스크립트를 가리키도록 고쳤다.
- **이메일 인증과 "0명 게이트"는 여전히 미확정 옵션으로 남는다** — 이 프로젝트가 실제
  공격 표면에 노출되는 트래픽을 다루게 된다면(ROADMAP.md > Unscheduled) 다시 검토할 수
  있다. 이 ADR은 그 옵션들을 영구히 배제하는 것이 아니라, 현재 단계에 맞지 않아 보류하는
  것이다.

### Addendum (2026-09-10) — `pnpm promote-superadmin`을 격리된 일회용 DB로 검증

`pnpm build`/`pnpm lint:ci`/`pnpm test`(263/263)는 변경이 컴파일되고 기존 서비스를
회귀시키지 않는다는 것만 증명할 뿐, 스크립트 자체의 DB 왕복은 전혀 건드리지 않는다 —
이 스크립트는 `data-source.ts`와 같은 방식으로 Nest DI 컨테이너 밖에 있기 때문이다.
이전 사고에서 얻은 격리 원칙(CLAUDE.md의 "Live-testing a sweep/reclaim service" 항목
참고)에 따라, dev DB(`postgres`)가 아니라 같은 로컬 Postgres 컨테이너 위의 일회용
DB로 검증했다:

1. `docker exec`로 `sharenpo_promote_verify`를 만들었다(존재하면 drop 후 create —
   `test/e2e-utils.ts`의 일회용 DB 패턴과 동일).
2. `DB_DATABASE=sharenpo_promote_verify pnpm migration:run`으로 실제 마이그레이션
   체인을 통해 스키마를 만들었다 — `synchronize`가 아니다.
3. 테스트 유저를 직접 insert한 뒤, 컴파일된 `dist/scripts/promote-superadmin.js`에
   대해 네 가지 시나리오를 실행하고 매번 `psql`로 결과를 직접 읽었다:
   - `user` 역할 계정 → `superadmin`으로 승격(DB에서 확인)
   - 이미 `superadmin`이 된 같은 계정에 재실행 → `"already superadmin — nothing to
     do."`, exit 0(중복 쓰기가 아니라 no-op)
   - 계정이 없는 이메일로 `SUPERADMIN_EMAIL` 설정 → 명확한 에러, exit 1
   - `SUPERADMIN_EMAIL` 미설정 → 명확한 에러, exit 1
4. 일회용 DB를 drop했고, dev DB엔 테스트 이메일 행이 0건임을 재확인했다 — 격리가
   지켜졌다.

**여전히 자동 테스트되지 않음**: 이 스크립트엔 Jest spec이 없다(`data-source.ts`가
이미 처한 것과 같은 위치 — `coveragePathIgnorePatterns`엔 없지만, 이 프로젝트의
커버리지가 측정하는 mock-repository 방식으로는 사실상 테스트 불가능하다. 하는 일 전체가
실제 DB 왕복이기 때문이다). 커버리지엔 미측정으로 나타날 것이며, 이는 이 addendum이
새로 만든 구멍이 아니라 `data-source.ts`가 이미 선례를 세운, 받아들여진 트레이드오프다.
