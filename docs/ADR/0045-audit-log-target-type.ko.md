# ADR 0045: 감사 로그 `targetType` — 다형 `targetId`를 위한 판별자

- Status: Accepted — implemented
- Date: 2026-08-24
- Amends: [ADR 0013](0013-rbac-and-audit-log.ko.md)의 "감사 로그" 항목 — 그 항목은
  `audit_log_entity`의 컬럼을 `actorId`, `targetId`, `action`, `detail`, `createdAt`으로
  나열할 뿐, `targetId`가 `action`에 따라 서로 다른 종류의 id를 담는다는 사실을 기록하지
  않았다. 여기서 컬럼 목록과 그 누락을 함께 바로잡는다. ADR 0013의 나머지(역할, 가드,
  엔드포인트, 시드)는 영향받지 않는다
- English: [0045-audit-log-target-type.md](0045-audit-log-target-type.md)

## Context

ADR 0013은 `audit_log_entity`를 FK 없는 append-only 테이블로 도입했다. 이 테이블에 쓰는
지점은 다섯 곳이고, 각 지점이 같은 `targetId` 컬럼에 서로 다른 종류의 id를 넣는다.

| 기록 지점 | `action` | `targetId`에 담기는 값 |
|---|---|---|
| `user.service.ts` `updateRole` | `ROLE_CHANGE` | 유저 id |
| `user.service.ts` `remove` | `USER_DELETE` | 유저 id |
| `file.service.ts` `deleteFile` | `FILE_DELETE` | **파일** id |
| `post.service.ts` `deletePost` | `POST_DELETE` | **게시글** id |
| `comment.service.ts` `deleteComment` | `COMMENT_DELETE` | **댓글** id |

즉 `targetId`는 판별자 없이 저장된 다형 참조다. 컬럼에는 정수 하나만 들어 있고, 그 정수가
어떤 종류를 가리키는지는 행 어디에도 적혀 있지 않다.

2026-08-12에 admin 콘솔의 유저 상세 패널을 위해 `GET /audit-log`에 `userId` 필터가
추가됐다(`docs/CHANGELOG.md`). 이 필터는 `actorId = :id OR targetId = :id`를 만들며, 모든
`targetId`를 유저 id로 읽는다. 그 시점에 이미 다섯 action이 모두 존재했으므로, 필터는
도입된 날부터 오탐을 내고 있었다 — 파일·게시글·댓글의 id가 우연히 어떤 유저 id와 같으면,
무관한 기록이 그 유저의 활동으로 조회된다.

가정이 아니라 실측이다. 2026-08-24 로컬 개발 DB 기준으로 감사 행은 114건이고, 그중
**62건**이 `FILE_DELETE`/`POST_DELETE`/`COMMENT_DELETE`인데 `targetId`가 실존하는 유저 id와
충돌한다. 최초 보고된 사례 — `/logs?userId=269`가 "파일 269 삭제" 기록을 반환했고 유저 269는
전혀 무관한 계정이었던 건 — 은 행 `id=73`이다.

이 다형성 자체가 어디에도 기록돼 있지 않았다. ADR 0013의 항목에도, 엔티티에도, 조회 DTO에도
없었다. admin 콘솔의 *표시* 계층은 2026-08-24에 별도로 교정됐고(커밋 `2e88072`),
`admin/src/lib/audit.ts`에 클라이언트 측 `targetLabel(action, targetId)` 매핑을 두어 잘못된
"User N" 라벨을 고쳤다. 그 CHANGELOG 항목은 백엔드 쪽 질문이 여전히 열려 있음을 명시했고,
아무것도 선점하지 않았다.

## Decision

### D1 — `targetId` 옆에 판별자 컬럼 `targetType`을 둔다

`FileMediaType`/`FileVisibility` 관례를 그대로 따르는 문자열 enum을 신설한다
(`backend/audit-log/audit-target-type.enum.ts`).

```typescript
export enum AuditTargetType {
  user = 'user',
  file = 'file',
  post = 'post',
  comment = 'comment',
}
```

`AuditLogEntity.targetType`은 `@Column({ type: 'varchar', nullable: true })`다. nullable인
것은 `targetId`(이미 `int, nullable: true`)를 그대로 따르기 위해서이며, 불변식은
`targetType IS NULL ⟺ targetId IS NULL`이다 — 별개로 선택적인 필드가 아니다. ADR 0040의
`mediaType`과 달리 `SET NOT NULL` 단계는 두지 않는데, 판별 대상인 컬럼 자체가 nullable이기
때문이다.

정수 코드도, Postgres 네이티브 `enum` 타입도 아닌 `varchar`를 쓰는 근거는 ADR 0013이
`UserEntity.role`에 대해 이미 제시한 것과 같다. 문자열 값은 DB 컬럼과 Swagger를 사람이 읽을
수 있게 유지하고, varchar 컬럼은 `ALTER TYPE` 없이 새 값을 받는다.

### D2 — 종류는 쓰는 쪽이 넘긴다. 읽는 쪽은 아무것도 추론하지 않는다

`AuditLogService.log()`가 종류를 명시적 파라미터로 받고
(`log(actorId, targetId, targetType, action, detail?)`), 다섯 호출 지점이 각자의 상수를
넘긴다. `findAll()`의 유저 브랜치는
`{ targetId: userId, targetType: AuditTargetType.user }`가 된다.

이렇게 쓰는 쪽을 거치게 하는 요점은, **런타임 읽기 경로에 `action` → 대상 종류 매핑이 아예
남지 않는다**는 데 있다. 백엔드에서 그 매핑은 마이그레이션의 일회성 백필 딱 한 곳에만
존재한다.

### D3 — `action`을 `string`에서 `AUDIT_ACTIONS` 유니온으로 좁힌다

`targetType`과 `action`은 둘 다 문자열이고 파라미터 목록에서 인접해 있어, 순서를 바꿔 넣어도
조용히 컴파일된다. `AuditAction`(`backend/audit-log/dto/audit-log-query.dto.ts`, 기존
`AUDIT_ACTIONS` 상수 옆)으로 네 번째 파라미터를 좁히면 두 유니온이 서로 겹치지 않게 되어,
순서를 바꾸는 순간 컴파일 에러가 난다. 곁다리 타입 강화가 아니라, D2가 늘린 위치 인자를
안전하게 만드는 장치다.

### D4 — 기존 행은 `action`에서 백필하고, 쓰는 것은 새 컬럼뿐이다

`backend/migrations/1787578451680-AddAuditLogTargetType.ts`는 nullable로 `ADD COLUMN`한 뒤
`UPDATE ... SET "targetType" = CASE "action" ... END WHERE "targetId" IS NOT NULL` 하나를
실행한다. 다섯 action 각각이 정확히 한 호출 지점에서 정확히 한 종류의 대상만 기록하므로,
모든 과거 행에 대해 도출이 결정적이다.

`actorId`, `targetId`, `action`, `detail`, `createdAt`은 결코 쓰지 않는다 — append-only
성질이 유지되고, 백필은 새 컬럼만 채운다. 생성된 diff의 FK·인덱스 `DROP`+`CREATE` 열두
문장은 CLAUDE.md가 문서화해 둔 스퓨리어스 제약조건 이름 변경 노이즈라서 제거했다.

`migration:run` 후 개발 DB에서 검증한 결과: 114행 전부 백필, 남은 `NULL` 0건, action별 분포가
매핑과 정확히 일치. 구 조건의 target 쪽 매칭 108건이 46건으로 줄어 오탐 62건이 모두 사라졌고,
actor 쪽 매칭 112건은 그대로다. 보고된 사례(`userId=269`)는 1건 → 0건이 됐다.

## Alternatives rejected

- **스키마 무변경, action 기반 쿼리 보정** —
  `actorId = :id OR (targetId = :id AND action IN ('ROLE_CHANGE','USER_DELETE'))`로 고치고,
  `Record<AuditAction, AuditTargetType>` 상수를 두어 새 action 누락을 컴파일 에러로 막는 안.
  오늘의 다섯 action에 대해 완전히 정확하고, 마이그레이션이 없으며, 파일 세 개만 건드린다.
  기각 이유는 이 안이 "`action`이 대상 종류를 결정한다"를 관찰이 아니라 **영구적이고 하중을
  받는 가정**으로 만들기 때문이다. 지금 그 매핑이 함수인 것은 각 action이 우연히 호출 지점
  하나와 대상 종류 하나만 갖고 있어서다. 두 종류를 대상으로 삼는 action이 하나만 생겨도(예:
  게시글과 댓글 모두에 걸리는 조치) 매핑은 무너지고, 여기서 미룬 마이그레이션을 더 커진
  테이블에서 하게 된다. 판별자를 참조 옆에 저장하는 것은 다형 연관에 대한 관례적 형태이기도
  하며, 그 비용(nullable 컬럼 하나 + 결정적 백필)은 114행인 지금이 가장 싸다.
- **대상 종류별 컬럼 분리**(`targetUserId`/`targetFileId`/`targetPostId`/`targetCommentId`)
  — 가장 명시적이지만, 대상 종류가 하나 늘 때마다 컬럼과 마이그레이션이 하나씩 늘고,
  append-only 테이블에서 행의 형태가 균일하지 않게 된다. 같은 이득에 대해 D1보다 명백히 더
  침습적이다.
- **`subjectUserId` — 이 기록이 어떤 유저에 관한 것인지를 저장** — D1보다 표현력이 크다.
  오탐 제거에 더해, 지금 필터가 놓치는 기록(예: admin이 *이 유저의* 파일을 삭제한 건)까지
  잡아낸다. 두 가지 이유로 기각했다. 과거 행은 아예 백필할 수 없다 — 파일·게시글·댓글이 이미
  삭제돼 소유자를 복구할 방법이 없으므로, 기존 114행에서 이 컬럼은 영원히 `NULL`로 남는다.
  그리고 `userId`가 반환하는 범위 자체를 넓히므로, 고치려는 결함을 넘어서는 동작 변경이다.
  나중에 별도로 결정해 추가할 수 있는 선택지로 남으며, D1이 그것을 막지 않는다.
- **`targetId`를 항상 유저 id로 정규화하고 리소스 id는 `detail`로 옮기기** — 다형성을
  기술하는 대신 원천에서 제거하는 안. append-only 제약에 걸려 기각했다. 기존 행에까지 이를
  참으로 만들려면 그 행들의 `targetId`를 다시 써야 하는데 이 테이블은 그것을 금지하고, 다시
  쓰지 않으면 같은 컬럼 이름 아래에서 과거 행과 신규 행의 의미가 갈린다.

## Consequences

- `GET /audit-log?userId=N`의 의미는 이제 "N이 행위자이거나, **또는** 유저를 대상으로 하는
  action의 대상이 N인 기록"이다. 대상이 파일·게시글·댓글인 기록은 행위자 쪽으로만 매칭된다.
  의도된 동작 변경이다 — admin 콘솔의 "Recent activity" 패널은 더 적은 행을 반환하고, 빠진
  행들은 틀린 것이었다.
- API 응답의 모든 기록에 `targetType` 필드가 생긴다. 이 엔드포인트는 엔티티를 그대로
  반환하므로 순수 추가이고 기존 클라이언트는 무시한다. 동시에 `admin/src/lib/audit.ts`의
  클라이언트 측 `TARGET_NOUN` 매핑이 불필요해진다 — 콘솔이 서버 필드를 대신 읽을 *수* 있다.
  이는 선택적 정리이며, 이번 변경 범위에서 의도적으로 제외했다.
- ADR 0013의 감사 로그 항목이 amend된다 — `targetType`이 컬럼 목록에 합류하고, 그 항목이
  언급하지 않았던 다형성이 여기에 기록된다.
- **배포 순서가 하중을 받는다.** 코드가 `targetType`을 쓰고 또 읽으므로, 마이그레이션이 새
  코드보다 먼저 실행돼야 한다 — 이미 이 프로젝트의 입장이다([ADR
  0032](0032-migration-as-separate-deploy-step.ko.md)). 마이그레이션 이후 *구버전* 코드가 쓴
  행은 `targetType`이 `NULL`이므로, 그것이 `ROLE_CHANGE`/`USER_DELETE`라면 대상 브랜치에서
  누락된다. 이 저장소에는 배포 파이프라인이 없으므로 조치 항목이 아니라 기록된 결과다.
- 인덱스는 추가하지 않았다. `actorId`, `targetId`, `targetType` 모두 전용 인덱스가 없고,
  엔티티의 유일한 인덱스는 여전히 `(action, createdAt)`이다. `userId` 필터가 도입될 때와
  마찬가지로, 이 볼륨에서는 수용한다.
- `action` → 대상 종류 지식은 이제 한 번만 쓰이는 두 곳에만 존재한다. 과거 행에 대한
  마이그레이션의 백필 `CASE`, 그리고 신규 행에 대한 다섯 호출 지점이다. 읽기 경로에는 없으므로,
  새 action이 조회표에서 누락되는 방식으로 오탐이 조용히 되살아날 수는 없다.
