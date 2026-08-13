# ADR 0023: Board 도메인 스키마 — post와 comment

- 상태: Accepted
- 결정일: 2026-07-30
- English: [0023-board-domain-schema.md](0023-board-domain-schema.md)

## 배경

ROADMAP §5(도메인 계획)와 Stage 3의 "Board domain" 항목 — 프로젝트 이름에 들어 있는 *board*가
아직 구현되지 않았다. 지금의 API는 영상 파일만 관리한다.

이 ADR은 그 구현이 아니라 **구현에 앞선 설계 게이트**다. [CLAUDE.md](../CLAUDE.md)의 Scope
Discipline은 엔티티 변경을 마이그레이션 생성 전에 평문으로 먼저 기술하도록 요구하는데, 이
문서가 두 엔티티 모두에 대한 그 기술이다. **이 ADR과 함께 들어가는 엔티티·마이그레이션·DTO·
서비스 코드는 없다.**

post와 comment를 의도적으로 *함께* 설계한다. 둘은 독립된 스키마가 아니다 — comment→post 외래
키, 계정 삭제 순서, post→file 참조는 결국 한 결정을 세 방향에서 본 것이다. post를 먼저 하고
comment를 나중에 설계하면 comment 작업 도중에 post의 삭제 경로를 다시 유도하게 되고, 그것이
바로 이 게이트가 막으려는 스키마 되돌림이다.

현재 코드를 추적해 확인한 제약이며, 아래 설계를 모두 구속한다.

| 사실 | 출처 | 설계에 미치는 영향 |
|---|---|---|
| 외래 키는 `ON DELETE NO ACTION`으로, 제약 이름은 사람이 읽는 형태(`FK_file_entity_creator`)로 선언한다 | `backend/migrations/1784678400000-InitialSchema.ts:36-38` | 새 FK도 같은 이름 규약을 따른다. `NO ACTION`에서 벗어나려면 근거를 대야 하며 당연시할 수 없다 |
| `FileEntity.creator`의 `cascade: true`는 TypeORM의 *persist* 캐스케이드로, 저장은 전파하지만 삭제는 전파하지 않는다 | [ADR 0020](0020-account-deletion-cascade.ko.md) 배경 | ORM 계층이 자식을 대신 지워 주지 않는다. 아래 모든 삭제 경로는 명시적으로 결정한다 |
| 쿼리는 관계의 소유 측만 사용한다 — `file.creator`는 6개 쿼리에 등장하고, 역방향 `UserEntity.creator`는 한 곳도 없다 | `backend/file/file.service.ts:121,152,182,345,428,486` (2026-07-30 확인) | 역방향 속성은 아무 이득이 없다. 아래 "관계는 단방향" 참조 |
| `canManage(creatorId, requester)` = 작성자 **또는** admin 이상 | `backend/file/file.service.ts:84-89` | 그대로 재사용한다. board는 새로운 인가 형태를 만들지 않는다 |
| 계정 삭제는 하나의 `dataSource.transaction()`이고, 되돌릴 수 없는 `unlink`는 커밋 **이후**에 실행한다 | [ADR 0020](0020-account-deletion-cascade.ko.md) | post/comment 삭제가 그 트랜잭션에 합류한다. unlink 순서는 그대로다 |
| 고유 제약 위반(`23505`)은 500이 아니라 타입 있는 결과로 번역한다 | [ADR 0019](0019-upload-claim-idempotency.ko.md) | 같은 기법이 중복 제출과 "사용 중인 파일 삭제"(`23503`)를 함께 해결한다 |
| 목록 조회 계층은 DTO 선언 파라미터 + 전체(total) `Record` 정렬 화이트리스트 + 이스케이프한 ILIKE + 유일한 tiebreaker | [ADR 0021](0021-list-query-search-filter-sort.ko.md) 결과 | post 목록은 그 계층을 **확장**한다. 다시 정의하지 않는다 |
| 라우트는 단수형을 유지한다(`/file`, `/user`). 복수형 개명은 검토 후 기각했다 | [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md) | `/post`, `/comment` |

## 결정

**새 엔티티 둘 — `post_entity`, `comment_entity` — 을 새 모듈 둘에 둔다. post는 파일 하나를
선택적으로 참조하며, 그 파일은 반드시 글 작성자 본인이 만든 것이어야 한다. comment는 평면
구조이고 DB 캐스케이드로 글과 함께 사라진다. 그 밖의 모든 삭제는
[ADR 0020](0020-account-deletion-cascade.ko.md)이 정한 대로 서비스에서 명시적으로 처리한다.**

### `post_entity`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `PrimaryGeneratedColumn` | 기존 두 엔티티와 동일 |
| `title` | `varchar`, **unique 아님** | 길이 제한은 컬럼이 아니라 DTO에서(≤100) |
| `body` | `text`, not null | DTO에서 제한(≤10,000) |
| `creatorId` | FK → `user_entity`, not null, `NO ACTION` | 속성명은 `FileEntity.creator`에 맞춰 `creator` |
| `fileId` | FK → `file_entity`, **nullable**, **UNIQUE**, `NO ACTION` | `@OneToOne` + `@JoinColumn`. D1 참조 |
| `createdAt` / `updatedAt` | `CreateDateColumn` / `UpdateDateColumn` | 공용 base 엔티티 없이 엔티티별 선언(기존 YAGNI 입장 유지) |

`title`은 `FileEntity.title`과 달리 의도적으로 unique가 **아니다**. 제목 하나를 전체 작성자를
통틀어 한 번만 쓸 수 있는 게시판은 기능이 아니라 결함이다 — 파일 제목의 기존 unique 제약은
여기서 따라할 패턴이 아니다. 그 대가로 post는 자기 텍스트에서 나오는 자연 idempotency 키를
갖지 못하며, 대신 D1이 그 키를 제공한다.

### `comment_entity`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `PrimaryGeneratedColumn` | |
| `body` | `text`, not null | DTO에서 제한(≤1,000) |
| `creatorId` | FK → `user_entity`, not null, `NO ACTION` | 속성명 `creator` |
| `postId` | FK → `post_entity`, not null, **`ON DELETE CASCADE`** | D3 참조 — 이 스키마에서 유일하게 허용한 DB 캐스케이드 |
| `createdAt` / `updatedAt` | | |

`parentId`는 두지 않는다 — 댓글은 평면 구조다(D2). 비정규화 카운터(`commentCount`,
`viewCount`)도 두지 않는다. 요구가 없고, 각각 나중에 컬럼을 더하면 되는 가산적 변경이다.

**관계는 단방향으로 선언한다.** `PostEntity`가 `creator`와 `file`을, `CommentEntity`가
`creator`와 `post`를 선언한다. `UserEntity`와 `FileEntity`에는 역방향 컬렉션 속성을 추가하지
않는다. 이는 "관계는 항상 명시" 규약을 어기는 것이 아니다 — 관계는 컬럼을 소유한 쪽에서 온전히
선언된다. 역방향을 생략하는 이유는 측정된 것이다. 지금 존재하는 유일한 역방향
(`UserEntity.creator`)은 어떤 쿼리도 쓰지 않으며(위에서 확인), 두 개를 더 추가하면 아무 쿼리도
읽지 않는 속성을 위해 blast radius가 큰 `*.entity.ts` 두 개를 편집하게 된다.

### D1 — post ↔ file은 1:1, 선택적, 동일 작성자

`post.fileId`는 **unique이면서 nullable한** FK다. 글은 영상을 최대 하나 갖고, 영상은 최대 하나의
글에 붙으며, 영상이 없는 글도 가능하다. **글은 자기 작성자가 만든 파일만 참조할 수 있다** — 이
검사는 파일 소유권의 권위를 가진 `FileService`에 있고 `PostService`가 그것을 물어본다.
`PostService`가 `file.creator.id`를 직접 읽는 일은 없다(Law of Demeter / Tell Don't Ask).

이 불변식은 장식이 아니라 구조를 지탱한다. ADR 0020의 계정 연쇄 삭제를 안전하게 만드는 것이
바로 이것이다. 사용자의 글은 같은 사용자의 파일만 참조할 수 있으므로, 계정의 글을 파일보다 먼저
지우면 삭제된 파일을 가리키는 글이 남을 수 없다 — FK 위반이 "가능성이 낮은" 정도가 아니라
구조적으로 도달 불가능해진다. N:1이었다면 남의 글이 내 파일을 참조하는 순간 ADR 0020이 없애려던
바로 그 `23503` → 500이 되살아난다.

unique 제약은 `title`이 주지 못하는 idempotency 키도 제공한다([CLAUDE.md](../CLAUDE.md) >
Maintainability > Idempotence는 새 쓰기 엔드포인트가 그 키를 명시하도록 요구한다). `POST /post`의
중복 제출 처리는 다음과 같다.

| `POST /post` 재전송 상황 | 결과 |
|---|---|
| 같은 `fileId`, 같은 작성자, `title`·`body`가 **완전히 동일** | **200** — 기존 글을 그대로 반환(재시도) |
| 같은 `fileId`, 같은 작성자, `title` 또는 `body`가 다름 | **409 `POST_FILE_TAKEN`** — 이미 그 파일을 가진 글을 알려 준다 |
| 같은 `fileId`, 다른 사용자 | **403 `FORBIDDEN_NOT_OWNER`** — 소유권 검사가 먼저 걸린다 |
| 존재하지 않는 `fileId` | **404 `FILE_NOT_FOUND`** |
| `fileId` 없음 | 두 번째 글이 생성된다 — 첨부 없는 글에는 자연 키가 없다(문서화된 수용) |

동시 이중 제출은 `UQ_post_entity_fileId`가 정리한다. 진 쪽이 `23505`를 받아 같은 표로 다시
판정한다. [ADR 0019](0019-upload-claim-idempotency.ko.md)의 메커니즘을 재사용하되 한 가지를
의도적으로 다르게 했다. ADR 0019는 claim 소유자에게 무조건 replay하지만, 이 엔드포인트는 페이로드가
일치할 때만 replay한다. 파일 승격에는 사용자가 작성한 내용이 없지만 글에는 있기 때문이다 —
제목과 본문이 *다른* 요청에 예전 글을 돌려주면, 새 글을 쓴다고 믿은 사람에게 엉뚱한 글을 조용히
반환하게 된다.

`fileId`는 생성 시점에 고정된다. `PATCH /post/:id`는 `title`과 `body`만 바꾼다 — 첨부를 변경
가능하게 만들면 그럴 요구도 없는 라우트에 두 번째 claim/replay 표면이 생긴다. 영상을 떼려면 글을
지우면 된다.

### D2 — 댓글은 평면 구조

`parentId`도 스레드도 없다. 데이터 형태가 하나면 정렬 규칙도, 페이지네이션 규칙도, 삭제 규칙도
하나다. 대댓글을 나중에 도입하는 것은 **가산적** 마이그레이션이다 — 백필 없는 nullable
자기참조 컬럼 하나 — 이므로 미루는 데 되돌림 비용이 없고, 되돌림이야말로 이 게이트가 없애려는
위험이다. 나중에 대댓글 기능이 결정해야 할 것(페이지네이션된 목록에서의 부모-자식 배치, 부모가
삭제될 때 자식 처리)은 감춘 것이 아니라 명시적으로 미룬 설계 작업이다.

### D3 — post 삭제는 FK로 comment까지 연쇄한다

`comment.postId`에 **`ON DELETE CASCADE`** 를 건다 — 이 스키마에서 유일한 DB 수준 캐스케이드다.
나머지는 전부 서비스의 명시적 연쇄 삭제로 남는다.

기준선은 이렇다. **자식이 독립적으로 존재할 수 없고 비-DB 부수효과도 없으면 DB 캐스케이드를
쓰고, 부모가 계정이면 서비스 연쇄 삭제를 쓴다** — 계정 경로는 확인 절차, 감사 기록, 물리적
unlink가 필요하기 때문이다. 댓글은 URL도 파일도 없고 글 밖에서는 의미가 없다. ADR 0020의
"`ON DELETE CASCADE`를 제안하지 말 것"은 `FileEntity.creator`에 한정된 규칙이며, 그 이유는 그
경로가 unlink할 저장 경로를 먼저 읽어야 한다는 것 — 여기에는 해당하지 않는다.

대안인 "서비스에서 댓글 행 삭제"는 단지 장황한 게 아니라 *더 나쁘다*. 계정 연쇄 삭제 때 "이
사용자의 글에 달린 남의 댓글"을 지우려면 `CommentService`가 `post_entity`에 하위질의를 날리거나
(모듈 경계 침범), 조금 전에 읽은 post id 목록으로 삭제해야 한다 — 후자는 ADR 0020이 금지한
읽고-지우는 경합 그 자체다. DB 캐스케이드에는 그 창이 없다.

대가는 결과 절에 적었다. 캐스케이드로 지워진 행 수는 서비스로 돌아오지 않으므로, 감사 detail은
post와 file 수는 세지만 comment 수는 세지 못한다.

### D4 — 글이 참조 중인 파일 삭제는 FK로 거부한다

글에 첨부된 파일에 대한 `DELETE /file/:id`는 `23503`을 일으키고, 이를 **409 `FILE_IN_USE`** 로
번역한다. 사전 검사 쿼리는 두지 않는다.

사전 검사는 서로 독립된 두 이유로 기각했다. 첫째, `FileService`가 `post_entity`를 읽게 되는데
`PostService`는 이미 파일 소유권을 `FileService`에 물어보므로(D1) **모듈 순환 의존**이 생겨
`forwardRef`가 필요해진다 — 이 코드베이스에 선례가 없는 패턴이다. 둘째, 검사와 삭제 사이에 창이
남는다. 그 사이에 생성된 글은 여전히 제약에 걸리므로 500이 사라지는 게 아니라 드물어질 뿐이다.
DB를 권위로 두면 경합도 순환도 없고, ADR 0019가 이미 `23505`에 적용한 것과 같은 기법이다.

`ON DELETE SET NULL`은 곧바로 기각했다. 삭제는 항상 성공하겠지만, 그 대가로 남이 공개한 글에서
영상만 조용히 빠져나간다.

### D5 — 계정 연쇄 삭제가 post·comment를 흡수하되, 확인 플래그의 범위는 그대로다

[ADR 0020](0020-account-deletion-cascade.ko.md)의 `?deleteFiles=true`는 지금 의미를 정확히
유지한다 — **파일 행과 저장 바이트**의 파기를 확인받는 것이고, 409 `USER_HAS_FILES`도 계정이
*파일*을 보유할 때만 발동한다. post와 comment는 같은 트랜잭션에서 별도 확인 없이 무조건
삭제된다.

플래그를 넓히지 않은 이유는, 그 플래그가 지키는 대상이 **공개 URL로 서빙되는 되돌릴 수 없는
미디어 바이트**이기 때문이다. 거기서의 조용한 연쇄 삭제가 용납되지 않는 이유가 그것이다. 텍스트
콘텐츠까지 넓히면 파라미터 이름(`deleteFiles`)과 에러 코드(`USER_HAS_FILES`)가 실제로 통제하는
범위보다 좁은 것을 가리키게 되고, 플래그를 하나 더 두면 표면이 동결된 라우트(ADR 0010)에 쿼리
파라미터가 추가된다. 정직한 비용 — 계정을 지우면 그 글과 거기 달린 모든 사람의 댓글이 확인 절차
없이 사라진다 — 은 덮지 않고 결과 절에 적는다.

기존 `dataSource.transaction()` 안의 순서이며, 모든 삭제는 조금 전에 읽은 id 목록이 아니라
`creatorId` 기준이다(ADR 0020).

1. 사용자가 작성한 댓글 전체(남의 글에 단 댓글은 다른 경로로는 닿을 수 없다),
2. 사용자의 글 — 그 글에 남아 있던 댓글은 FK 캐스케이드가 제거한다,
3. `deleteFiles=true`일 때만: 저장 경로를 읽은 뒤 파일 행 삭제,
4. user 행,
5. **커밋 이후**: 저장 파일 unlink. best-effort이며 실패는 `warn`으로 로깅한다.

### 삭제 동작 전체 표

| 요청 | post 행 | comment 행 | file 행 | 디스크 |
|---|---|---|---|---|
| `DELETE /comment/:id` | — | 해당 댓글 | — | — |
| `DELETE /post/:id` | 해당 글 | 그 글의 댓글(FK 캐스케이드) | **유지** | **유지** |
| `DELETE /file/:id`, 첨부 안 됨 | — | — | 삭제 | unlink(커밋 후) |
| `DELETE /file/:id`, 글에 첨부됨 | — | — | **거부 — 409 `FILE_IN_USE`** | 그대로 |
| `DELETE /user/:id`, 파일 보유·플래그 없음 | — | — | **거부 — 409 `USER_HAS_FILES`** | 그대로 |
| `DELETE /user/:id`, 파일 없음 | 사용자의 글 전체 | 작성한 댓글 + 자기 글에 달린 댓글 | — | — |
| `DELETE /user/:id?deleteFiles=true` | 사용자의 글 전체 | 위와 동일 | 삭제 | unlink(커밋 후) |

글을 지워도 파일은 의도적으로 남긴다. 파일 행은 `FileModule`의 것이고 글보다 먼저 존재하며(2단계
업로드 → `POST /file` → `POST /post`), `GET /file`에 계속 나오고 `DELETE /file/:id`로 지울 수
있다. 글은 파일의 *참조자*이지 소유자가 아니다.

### 소유권, RBAC, 가드

- 글과 댓글의 수정·삭제는 **작성자 또는 admin 이상**이 필요하다 — `canManage`를 그대로
  재사용하며([ADR 0013](0013-rbac-and-audit-log.ko.md)), 403 `FORBIDDEN_NOT_OWNER`를 던진다.
- **글 작성자에게 자기 글의 댓글을 관리할 권한을 주지 않는다.** 그 세 번째 인가 축을 넣으려면
  `comment.post.creator.id`로 도달해야 하는데, 이는 Structure Analysis 체크리스트가 금지하는
  reach-through이고 스팸 대응은 admin 조정으로 이미 커버된다. 필요해지면 별도 결정이 필요하다.
- 모든 board 라우트는 읽기 포함 `JwtAuthGuard` 뒤에 둔다. 비인증 공개 읽기는 여기서 도입하지
  않으며, 기본 가드 원칙이 유지된다.
- 삭제는 기존과 같이 감사에 남긴다(ADR 0013). `POST_DELETE`, `COMMENT_DELETE` 액션을 추가하고
  주 트랜잭션 커밋 후에 기록한다. `action`은 평범한 `varchar`이므로 값 추가에 스키마 변경이 없다.
  `USER_DELETE`의 detail에는 기존 `files=N` 옆에 `posts=N`이 붙는다.

### 라우트, 모듈, 트랜잭션 패턴

| 라우트 | 비고 |
|---|---|
| `GET /post` | ADR 0021 조회 계층 확장: `search`(`title`에 이스케이프한 ILIKE), `creatorId`, `sortBy` ∈ {`createdAt`,`title`,`id`}, `order`, `take`/`skip`, `id` tiebreaker |
| `GET /post/:id` | 조인으로 `creator`와 `file`을 함께 로드한다. N+1 없음 |
| `POST /post` | D1의 claim 판정 |
| `PATCH /post/:id` | `title`, `body`만 |
| `DELETE /post/:id` | D3 |
| `GET /post/:postId/comment` | 페이지네이션, `createdAt ASC` + `id` tiebreaker — 스레드는 파일 목록의 최신순과 달리 오래된 순으로 읽는다 |
| `POST /post/:postId/comment` | 글이 없으면 404 `POST_NOT_FOUND` |
| `PATCH /comment/:id`, `DELETE /comment/:id` | `body`만, `canManage` |

`search`는 ADR 0021과 동일하게 `title`만 대상으로 한다. 본문 검색은 그 ADR이 유보한
full-text / `pg_trgm` 트리거를 그대로 물려받으며 여기서 열지 않는다.

모듈은 `PostModule`(`FileModule`·`AuditLogModule`을 import, `PostService`를 export)과
`CommentModule`(`PostModule`·`AuditLogModule`을 import, `CommentService`를 export)이다.
`UserModule`은 계정 연쇄 삭제를 위해 둘 다 import하며, ADR 0020이 추가한 `FileModule` 엣지는
그대로다. 결과 그래프 — `User → {File, Post, Comment}`, `Post → File`, `Comment → Post` — 는
비순환이며, 그렇게 되는 **이유가 바로** D4가 `FileModule`이 `PostModule`을 필요로 하지 않게 만든
데 있다. 새 도메인에 새 모듈 둘은 모듈 정책이 명시적으로 허용한 경우다(ROADMAP §4).

트랜잭션 패턴은 CLAUDE.md > Transaction Boundary 표에서 고른다.

| 작업 | 패턴 | 근거 |
|---|---|---|
| `POST /post`, `PATCH`, `DELETE /post/:id`, 모든 댓글 쓰기 | 1행 — 단순 repository 호출 | 각각 DB 쓰기 하나뿐이다. 댓글 연쇄는 DB의 몫이고, 감사 행은 커밋 후에 쓴다 |
| 계정 연쇄 삭제 | 3행 — `dataSource.transaction()` | 이미 ADR 0020이 확립한 경계에 post와 comment가 합류한다 |
| — | 2행 — 수동 QueryRunner | **이 도메인에서는 쓰지 않는다.** 경계 안에 비-DB 부수효과를 가진 board 작업이 없다. 그 패턴은 파일 승격 경로 전용으로 남는다 |

`PostResponseDto`에는 파일의 공개 URL이 포함된다. `BASE_URL` 조합은 `FileService`에 그대로 두고
재사용하며 복제하지 않는다 — 설정 접근은 한 곳에 유지된다.

### 인덱스

최초 마이그레이션에서 함께 채택한다.

- `IDX_comment_entity_postId_createdAt` — `("postId", "createdAt")`. 특정 글의 댓글 목록을
  순서대로 읽는 것이 이 테이블의 *유일한* 조회 형태다. `AuditLogEntity`의
  `["action", "createdAt"]`과 같은 복합 인덱스 논리이며, 선두 컬럼이 FK도 함께 서빙한다.
- `UQ_post_entity_fileId` — D1의 제약 그 자체. PostgreSQL이 자동으로 인덱스를 만들고, D4의
  `23503` 검사가 그 인덱스 위에서 동작한다.

유보하되 각각의 트리거를 함께 기록한다. ADR 0021이 세 개를 유보한 것과 동일하게, 마이그레이션이
아니라 평문 기술이다.

- `post("createdAt" DESC, "id" DESC)` — 기본 정렬용. 행 수가 정렬 비용을 측정 가능하게 만드는
  시점(대략 10⁴행 이상)에 정당해진다.
- `post("creatorId")`, `comment("creatorId")` — PostgreSQL은 FK 컬럼을 자동으로 인덱싱하지
  않는다. `creatorId` 필터와 계정 연쇄 삭제를 서빙한다. ADR 0021이 `file("creatorId")`를 유보한
  것과 대칭을 맞춰 유보한다. 계정 삭제는 순차 스캔을 먼저 최적화할 만큼 잦은 작업이 아니다.
- `pg_trgm` GIN on `lower(post.title)` — `ILIKE '%term%'`가 인덱스를 쓸 수 있게 하는 전제
  조건이다. 확장 설치가 필요하므로 두 단계 마이그레이션이 된다.

## 기각한 대안

- **N:1 post → file** — 영상 하나를 여러 글에서 재사용할 수 있다. 기각: `POST /post`가 가진
  유일한 자연 idempotency 키가 사라지고, 파일 하나의 삭제가 몇 개인지 모를 글에 영향을 주며,
  결정적으로 남의 글이 내 파일을 참조하는 순간 ADR 0020이 제거한 FK 위반 500이 되살아난다.
- **`post_file` 조인 테이블을 통한 M:N** — 글당 다중 첨부, 가장 유연한 형태. 근거 없는 확장으로
  기각한다. 업로드 표면은 단일 `video` 필드이고(ADR 0005) 다중 첨부를 요구하는 요건이 없으며,
  조인 테이블은 모든 삭제 경로에 정리 단계를 더하는 동시에 unique 키 replay를 잃게 한다.
- **파일 참조 자체를 두지 않음** — 가장 작은 스키마이자, 도메인을 유일하게 충족하지 못하는 안.
  글에 업로드를 보여줄 수 없는 *업로드 보드*다.
- **`FileEntity.title`처럼 `post.title`을 unique로** — `POST /post`에 idempotency 키를 공짜로
  준다. 기각: 전체 작성자를 통틀어 제목이 유일해야 하는 것은 게시판의 결함이지 기능이 아니다.
- **1단 대댓글(`parentId`, depth 1 제한)** — 통상적인 게시판 형태. 거부가 아니라 유보다. 지금
  도입하면 대댓글 요구가 없는 작업에서 페이지네이션된 목록의 부모-자식 배치 규칙과 자식 고아
  처리 규칙을 정해야 하는데, 나중 마이그레이션은 순수하게 가산적이다.
- **서비스 수준 댓글 연쇄 삭제** — 표면상 ADR 0020과 일관된다. 메커니즘 때문에 기각: 계정 연쇄
  삭제에서 `post_entity`에 대한 모듈 간 하위질의를 쓰거나, ADR 0020이 닫은 경합을 다시 여는
  읽고-지우는 id 목록 방식이 필요하다.
- **`DELETE /file/:id` 사전 검사** — 거부 의도가 코드에 드러나지만, `File ↔ Post` 모듈 순환을
  만들어 `forwardRef`가 필요해지고 경합 창도 여전히 남는다.
- **`post.fileId ON DELETE SET NULL`** — 파일 삭제는 항상 성공하지만, 그 대가로 공개된 글에서
  영상이 조용히 빠진다.
- **글 삭제에 확인 플래그(`?deleteComments=true`)** — ADR 0020과 형태만 대칭이다. 댓글은 독립
  존재도 URL도 없으므로 플래그가 지킬 대상이 없고, 일반 경로만 2단계 잡무가 된다.
- **`deleteFiles=true`의 범위 확대 또는 플래그 추가** — D5의 더 보수적인 두 해석. 그곳에 적은
  대로 기각한다. 전자는 파라미터·에러 코드 이름을 부정확하게 만들고, 후자는 동결된 라우트에
  파라미터를 추가한다.
- **글 작성자의 댓글 관리 권한** — 실제 게시판 관례지만, 구현하려면 이 프로젝트가 금지한
  `comment.post.creator` reach-through가 필요하고, 해당 사례는 admin 조정으로 이미 커버된다.
- **ADR 0019처럼 `POST /post` 재전송을 무조건 replay** — 더 단순하고 선례를 따른다. 기각 이유는
  글에는 파일 승격에 없는 작성자 작성 콘텐츠가 있다는 점이다. 무조건 replay하면 실제로 다른
  제출에 남이 예전에 쓴 글을 돌려주게 된다.

## 결과

- **이 ADR은 코드를 바꾸지 않는다.** 후속 구현 과제가 마이그레이션(테이블 2, FK 4, unique 제약 1,
  인덱스 1)을 생성하며, `*.entity.ts`를 건드리려면 승인이 필요하다. `migration:generate` 출력은
  한 줄씩 검토하고, 베이스라인의 사람이 읽는 제약 이름 때문에 발생하는 불필요한 rename 구문은
  걷어낸다([ADR 0006](0006-schema-policy-and-migration-adoption.ko.md)).
- **새 에러 코드 셋** — `POST_NOT_FOUND`, `COMMENT_NOT_FOUND`(404), `FILE_IN_USE`(409) — 과 D1의
  페이로드 불일치 분기용 `POST_FILE_TAKEN`(409)이 추가된다. 코드 추가는 파괴적 변경이 아니다
  ([ADR 0011](0011-error-code-contract.ko.md)).
- **필요해 보였으나 도달 불가능함이 증명되어 설계 도중 제거된 코드가 하나 있다**: "그 파일은 이미
  *다른 사용자의* 글에 첨부돼 있다"는 상황은 발생할 수 없다. 동일 작성자 검사(D1)가 고유성 질문이
  나오기도 전에 403으로 거절하기 때문이다. CLAUDE.md는 도달 불가능한 가드를 금지하므로 그런
  분기는 명세하지 않는다.
- **계정을 삭제하면 그 글과 거기 달린 모든 댓글이 확인 절차 없이 사라진다**(D5). 409 확인은 여전히
  파일만 지킨다. 글 손실을 경고하려는 클라이언트는 스스로 그렇게 해야 한다.
- **감사 기록은 post는 세지만 comment는 세지 못한다.** 캐스케이드로 지워진 행은 DB가 제거하고
  서비스가 세지 않는다 — D3에서 수용한 대가다.
- **이 스키마에 `ON DELETE CASCADE`가 정확히 하나 생긴다.** ADR 0020의 금지는 그대로 유효하고
  여전히 `FileEntity.creator`를 구속한다. 둘 사이의 경계선은 D3에 적혀 있으며, 앞으로 어떤 FK가
  캐스케이드를 요구할 때마다 그 기준을 인용해야 한다.
- **`FileModule`은 소비자 하나와 의무 하나를 얻는다**: `PostService`가 특정 사용자가 그 파일을
  첨부할 수 있는지 물어보고, `DELETE /file/:id`는 `23503`을 500으로 흘리지 말고 번역해야 한다 —
  ADR 0020이 `DELETE /user/:id`에서 고친 것과 같은 부류의 버그다.
- **post 목록은 ADR 0021을 다시 구현하지 않고 물려받는다.** 결정적 tiebreaker도 포함된다.
  `ORDER BY` 없는 post 목록은 그 ADR이 기록한 offset 결함을 그대로 반복하게 된다.
- **의도적으로 미룬 것들이며 각각 별도 결정이 필요하다**: 대댓글, 본문 검색, 비정규화 카운터, 글
  작성자의 댓글 관리, 비인증 공개 읽기.
- **기존 결정들과 교차 검토했다** — ADR 0013(소유권 형태, 감사 액션, 기본 가드), ADR 0019(`23505`를
  타입 있는 결과로), ADR 0020(하드 삭제, soft delete 미채택, 서비스 명시 연쇄, 커밋 후 unlink,
  `creatorId` 기준 삭제), ADR 0021(조회 계층 재사용) — 모순은 발견되지 않았다. 유일하게 충돌로
  보이는 D3의 DB 캐스케이드는 범위를 한정하고 근거를 밝혔다.

## 구현 노트 (post 모듈, 2026-07-31)

위 결정은 그대로다. 아래는 실제로 어떻게 착지했고 무엇이 열린 채 남았는지에 대한 기록이며,
새로운 결정을 추가하지 않는다.

**두 과제로 쪼갰다.** 설계는 post와 comment를 함께 다루지만 구현은 post가 먼저다 — comment가
post에 의존하지 그 반대가 아니기 때문이다. 그래서 마이그레이션도 이 ADR의 Consequences가 적은
한 벌이 아니라 두 벌로 나뉘었다. 이번 과제는 `post_entity`(FK 2개, `UQ_post_entity_fileId`)를
만들었고, `comment_entity`와 `IDX_comment_entity_postId_createdAt`은 comment 과제 몫이다.
스키마 자체는 달라진 것이 없다. 이번에 필요한 에러 코드 셋(`POST_NOT_FOUND`, `POST_FILE_TAKEN`,
`FILE_IN_USE`)은 추가했고, `COMMENT_NOT_FOUND`는 소비자보다 먼저 만들지 **않았다** — 도달할 수
없는 코드는 죽은 표면이기 때문이다.

`migration:generate`는 [ADR 0006](0006-schema-policy-and-migration-adoption.ko.md)이 예고한
그대로 동작했다. 의도한 네 문장 옆에, `FK_file_entity_creator`와
`IDX_audit_log_entity_action_createdAt`을 베이스라인의 읽기 쉬운 이름에서 TypeORM 해시 이름으로
바꾸기만 하는 drop/재생성 네 문장이 딸려 나왔다. 이는 걷어냈고, 새 제약은 읽기 쉬운 이름을
그대로 따랐다(`PK_post_entity`, `UQ_post_entity_fileId`, `FK_post_entity_creator`,
`FK_post_entity_file`).

**설계가 함의했지만 이름 붙이지 않았던 두 가지.**

- `FileService.toResponse`를 private에서 public으로 올렸다. D1은 `BASE_URL` 합성이
  `FileService`에 남고 재사용된다고 못박았는데, 매퍼를 공개하는 것이 곧 `PostService`가 URL을
  다시 조립하지 않고 재사용하는 방법이다. `PostService`는 `file.creator`를 건드리지 않는다.
- `FileService.assertAttachableBy(fileId, requesterId)`는 D1의 "FileService에게 묻는다"를
  게터가 아니라 판정으로 구현한 것이다. **의도적으로 `canManage`가 아닌 신원 일치만** 본다 —
  admin이 남의 파일을 첨부할 수 있게 하면 계정 연쇄를 FK 안전하게 만드는 바로 그 불변식이
  깨지므로, RBAC로 이 검사를 넓히지 않는다.

**설계가 구조적으로 불가능하다고 본 경우 중 실제로는 도달 가능한 것 하나.** D1은 같은 작성자
규칙 덕분에 "남의 파일을 참조하는 게시글"이 나올 수 없다고 논증한다. *작성 시점*에는 맞지만,
`PATCH /file/:id { userId }`가 사후에 파일 소유권을 넘길 수 있어 정확히 그 상태를 만들 수 있다.
여기서 두 가지가 따라오며, 이번 과제는 둘 다 의도적으로 손대지 않았다 — 해결은 구현 세부가 아니라
결정이기 때문이다.

1. `resolveAttachment`는 replay 전에 작성자 신원을 확인한다. 이것이 없으면 파일의 새 소유자가
   이전 소유자의 게시글을 "재시도" 결과로 받게 된다. 소유권 이전 때문에 *도달 가능한* 분기이므로
   금지된 "도달 불가능한 가드"에 해당하지 않는다.
2. `DELETE /user/:id?deleteFiles=true`는 여전히 트랜잭션 안에서 `23503`을 낼 수 있다 — 그 계정의
   파일이 다른 사용자로부터 이전된 것이고 그 사용자의 게시글이 아직 참조 중일 때 — 그리고 이는
   ADR 0020이 없애려 한 바로 그 불투명한 500으로 드러난다. 사전 이전이 있어야 하니 좁은 경로지만
   실재하며, **미해결**로 둔다. 여기서 고치지 않고 ROADMAP > 미배정에 올린 이유는 가능한 처방이
   전부 결정이기 때문이다 — 첨부된 파일의 소유권 이전을 거절할지, 연쇄를 "그 계정의 파일을 *참조만*
   하는 게시글"까지 넓힐지, 아니면 `23503`을 타입 있는 거절로 번역할지.
   **comment 과제보다 먼저 결정한다**: 두 번째 후보가 계정 연쇄의 삭제 순서를 바꾸는데 comment
   과제가 바로 그 순서를 확장하므로, 나중에 결정하면 같은 순서를 두 번 고치게 된다.

**검증**: `pnpm lint` 무결, 단위 테스트 121개, e2e 52개(신규 14개 — post CRUD, 소유권 403 거절,
같은 `fileId` 재제출의 replay/409, 409 `FILE_IN_USE`, 계정 연쇄의 `posts=N` 감사 detail).

## 구현 노트 (comment 모듈, 2026-07-31)

위 결정은 그대로다. 이 노트는 후반부가 어떻게 착지했는지만 기록하며 새 결정을 더하지 않는다. 이
과제가 기다리던 게이트 — post 노트가 남긴 post↔file 불변식 gap — 는
[ADR 0024](0024-account-cascade-fk-refusal.ko.md)로 먼저 정리했고, 계정 연쇄의 삭제 순서를 건드리지
않았으므로 아래 순서는 다시 쓴 것이 아니라 끼워 넣은 것이다.

`comment_entity`는 설계 그대로 들어갔다: `body`(`text`, 길이는 DTO에서 ≤1,000), `creatorId`
FK(`NO ACTION`), `postId` FK(**`ON DELETE CASCADE`** — 여전히 이 스키마의 유일한 DB 연쇄), 그리고
`IDX_comment_entity_postId_createdAt`. `migration:generate`는
[ADR 0006](0006-schema-policy-and-migration-adoption.ko.md)이 예고한 대로 또 굴었다 — 이번엔 spurious
6문장으로, `FK_file_entity_creator`·`FK_post_entity_creator`·`FK_post_entity_file`과
`IDX_audit_log_entity_action_createdAt`을 TypeORM 해시 이름으로 바꾸기 위해서만 drop 후 재생성하려
했다. 전부 걷어내고 새 제약에는 읽을 수 있는 이름을 붙였다(`PK_comment_entity`,
`FK_comment_entity_creator`, `FK_comment_entity_post`).

`COMMENT_NOT_FOUND`는 post 노트에 적은 대로 이제서야, 소비자와 함께 추가했다. `COMMENT_DELETE`는
`AUDIT_ACTIONS`에 합류했다.

**설계가 함축했지만 명시하지 않은 세 가지.**

- **컨트롤러는 하나가 아니라 둘.** ADR 0023의 라우트 표는 접두사 두 개에 걸쳐 있다 — 스레드는 글에
  매달리고(`GET`/`POST /post/:postId/comment`), 이미 존재하는 댓글은 자기 id로 지목된다
  (`PATCH`/`DELETE /comment/:id`). 하나의 `@Controller`로는 둘을 함께 감당할 수 없어
  `PostCommentController`와 `CommentController`를 두되 모두 `CommentModule` 소속으로 뒀다. ADR이
  나열한 네 라우트만 존재한다. 구현 중 `GET /comment/:id`를 만들었다가 지웠다 — 어떤 결정도 요구하지
  않은 엔드포인트는 범위 초과이기 때문이다.
- **`PostService.assertPostExists(postId)`** 는 D1의 "FileService에 묻는다"에 대응하는 comment 쪽
  장치다. 게터가 아니라 판정이므로 `CommentService`는 `post_entity`를 직접 조회하지 않는다.
  `getPostById` 재사용 대신 조인 없이 존재만 확인하는데, 전자는 아무도 읽지 않을 응답을 만들려고
  creator와 file 관계를 끌고 오기 때문이다.
- **댓글 목록은 게시글을 조인하지 않는다.** `postId`는 이미 라우트에서 알고 있으므로, 조인하면 글
  한 행이 스레드의 모든 댓글마다 반복된다. 그래서 `toResponse`가 id를 인자로 받고,
  `CommentResponseDto`는 글을 임베드하지 않고 `postId`만 싣는다.

**설계가 정한 대로 두고 완화하지 않은 두 가지.**

1. **`USER_DELETE` 감사 detail에 `comments=N`을 넣지 않았다.** 서비스는 자기가 명시적으로 지운
   댓글은 셀 수 있지만 FK 연쇄가 가져간 것은 셀 수 없고, 반쪽 집계는 총계처럼 읽힌다. 결과 절이 이미
   "감사는 글은 세지만 댓글은 세지 않는다"를 수용했으므로, 셀 수 있는 절반만 넣는 것은 개선처럼
   보이면서 실제로는 그 결정과 어긋난다.
2. **댓글에는 멱등 키가 없다.** 이 행에는 유니크한 것이 없으므로 `POST /post/:postId/comment` 재제출은
   두 번째 댓글을 만든다. D1이 `fileId` 없는 글에 대해 문서화한 결과와 같으며, 실수가 아니라 결정으로
   남도록 두 테스트 스위트 모두에 고정해 뒀다.

**검증**: `pnpm lint` 무결(에러 0, 경고 0), 단위 테스트 141개(`CommentService` 신규 16개, 그리고
`assertPostExists`와 연쇄 순서 단언), e2e 64개(신규 11개 — 스레드 CRUD, 오래된 순 페이지네이션,
읽기·쓰기 양쪽에서 없는 글에 대한 404, 소유권 403 거절 *및* 글 작성자가 자기 글의 댓글에 아무 권한도
없음, `COMMENT_DELETE` 감사, 게시글 삭제 시 FK 연쇄, 계정 연쇄가 남의 글에 달린 그 계정의 댓글까지
가져가는 것). `/doc`은 네 라우트를 모두 `Comment API` 아래 `@ApiBearerAuth`와 함께 렌더한다.
