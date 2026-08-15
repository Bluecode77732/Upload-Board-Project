# ADR 0020: 삭제 정책 — soft delete 대신 확인 기반 계정 연쇄 삭제

- 상태: Accepted
- 결정일: 2026-07-30
- English: [0020-account-deletion-cascade.md](0020-account-deletion-cascade.md)

## 배경

ROADMAP Stage 2의 설계 과제 하나는 두 질문을 함께 묶고 있다. 이 프로젝트가 soft delete를
채택할 것인가, 그리고 파일을 보유한 계정에 `DELETE /user/:id`가 들어오면 어떻게 할 것인가.
코드를 따라가 보니 어디에도 기록되지 않은 세 번째 문제가 더 있었다.

| 경로 | 이 ADR 이전의 동작 |
|---|---|
| 파일 보유 계정에 `DELETE /user/:id` | `userRepository.delete(id)` → Postgres `23503` 외래키 위반 → `HttpException`이 아니므로 **500 `INTERNAL_ERROR`**, 메시지는 "Internal server error" |
| `DELETE /file/:id` | 행만 지운다. 저장된 `granted_` 파일은 **한 번도 unlink되지 않아** 디스크에 영구히 남고, `ServeStaticModule`을 통해 계속 공개 서빙된다 |

FK는 baseline 마이그레이션에서 `FK_file_entity_creator ... ON DELETE NO ACTION`이고,
`FileEntity.creator`의 `cascade: true`는 TypeORM의 *persist* cascade다 — 저장을 전파할 뿐
삭제와는 무관하므로 여기서 하는 역할이 없다. 고아 파일 누수는 [ADR 0018](0018-orphan-temp-file-cleanup.ko.md)이
`temp_` 파일에 대해 닫은 문제와 정확히 대칭이지만, `file/upload`를 훑는 sweep은 없다. 그
sweep의 전제는 "`file/temp`에 있는 `temp_` 파일은 미청구 상태"라는 것인데, 이는 행이 사라진
승격 파일에 대해서는 아무것도 말해 주지 않기 때문이다.

## 결정

**삭제는 hard delete로 유지하고, 계정은 그 계정이 소유한 파일과 함께 삭제한다 — 단 요청에
실린 명시적 확인이 있을 때만.** soft delete는 채택하지 않는다.

- **`DELETE /user/:id?deleteFiles=true`**는 연쇄 삭제한다: 계정의 파일 행 → 계정 행 →
  저장된 물리 파일 순서.
- **확인이 없으면**, 파일을 보유한 계정의 삭제는 **409 `USER_HAS_FILES`**(신규 코드)로
  거절한다. 메시지에 파일 개수를 담는다. 이 거절은 아무것도 파괴하지 않으며 몇 번을 반복해도
  같은 결과다. `deleteFiles=false`는 플래그가 없는 것과 완전히 동일하게 취급한다.
- 확인은 **필수 왕복이 아니라 백스톱**이다. 이미 사용자에게 경고를 띄운 클라이언트는 첫
  요청에 플래그를 실어 보내며 409를 볼 일이 없다. 409는 경고 단계를 건너뛴 요청 — curl,
  스크립트, 다른 클라이언트 — 이 조용히 파일을 파괴하지 못하게 하려고 존재한다.
- **파일이 없는 계정의 삭제는 플래그 유무와 무관하게 기존과 완전히 동일하다.**
- **관리자도 같은 규칙을 따른다.** 이 엔드포인트는 RBAC상 이미 "본인 또는 관리자"를 허용하며,
  연쇄 삭제에 추가 제한을 두지 않는다. 감사 로그가 그 사실을 남긴다.
- **`DELETE /file/:id`는 이제 행을 지운 뒤 물리 파일도 unlink한다** — 위 누수를 닫는다.

부수적 구현이 아니라 결정의 일부인 메커니즘:

- **트랜잭션 패턴**: `dataSource.transaction()`(트랜잭션 패턴 표 3행). 경계 안은 순수 DB
  쓰기만 남고 파일시스템 부수효과는 의도적으로 경계 *바깥*에 두므로 수동 QueryRunner가 필요 없다.
- **unlink는 커밋 이후에 한다.** `unlink`는 롤백할 수 없다. 경계 안에 두면 커밋 실패 시
  행 없는 파일이 남아 복구가 불가능하다. 바깥에 두면 unlink 실패 시 디스크에 고아 파일이
  남을 뿐이고, 이는 복구 가능하며 기존 상태와 다르지 않다. 되돌릴 수 없는 단계를 항상 마지막에
  두는 것이다. (`uploadFile`은 정반대로 `rename`이 경계 *안*에 있다. rename이 실패하면 파일이
  `file/temp`에 그대로 남아 롤백된 상태와 정확히 일치하기 때문이다.)
- **파일 행은 계속 FileModule의 책임이다.** `UserService`가 트랜잭션을 소유하고 자신의
  `EntityManager`를 `FileService.findStoredPathsOfCreator` / `deleteFilesOfCreator`에
  넘긴다. `FileModule`이 `FileService`를 export하고 `UserModule`이 이를 import한다.
  `UserService`가 `FileEntity`를 직접 다루는 일은 없다(모듈 책임 경계).
- **행 삭제는 방금 읽은 id 목록이 아니라 `creatorId` 기준으로 한다.** 조회와 삭제 사이에
  삽입된 파일이 있으면 그 행이 살아남아 FK 위반을 다시 일으키기 때문이다. 남는 위험은 그
  파일의 물리 바이트가 unlink 목록에 없다는 것 — 고아 파일이지 깨진 행은 아니다.
- **확인 플래그는 boolean이 아니라 문자열 리터럴이다.** 추정이 아니라 실측 결과다. 전역
  파이프의 `enableImplicitConversion`이 수행하는 Boolean 변환은 순수 truthiness 캐스팅이며,
  커스텀 `@Transform`보다 *먼저* 실행된다. 따라서 boolean으로 선언하면 `?deleteFiles=false`가
  `true`가 되어 호출자가 명시한 의사와 반대로 플래그가 발동한다. 그래서
  `DeleteUserQueryDto`는 `deleteFiles?: 'true' | 'false'`를 `@IsIn`과 함께 선언하고
  컨트롤러가 이를 좁힌다. `delete-user-query.dto.spec.ts`가 실제 파이프 설정 그대로 이 동작을
  단언하므로 같은 위험이 조용히 되살아날 수 없다.
- **스키마 변경 없음.** FK는 `ON DELETE NO ACTION` 그대로 두고 연쇄는 서비스에서 명시적으로
  수행한다. unlink에 필요한 경로를 읽는 곳도 어차피 그 지점이다.

## 기각한 대안

- **soft delete(User/File에 `@DeleteDateColumn`)** — 복구 가능한 유일한 선택지이고 FK 문제도
  구조적으로 사라진다. 기각 이유: high-blast-radius 엔티티 두 개의 스키마 변경에 더해 모든
  조회에 `withDeleted` 정책이 필요하고, `user.email`과 `file.title`의 unique 제약은
  soft-deleted 행에도 그대로 걸려 삭제된 제목·이메일을 영영 재사용할 수 없으며, soft-deleted
  파일의 바이트는 디스크에 남아 **계속 공개 서빙된다**(인증 기반 재생은 Stage 4 항목). 즉
  "삭제된" 콘텐츠를 URL만 아는 누구나 계속 볼 수 있다. 또한 현재 `DELETE /user/:id`가 지고
  있는 잊힐 권리 해석과 정면으로 충돌한다. 구체적인 복구 요구사항이 생겼을 때 다시 검토할
  일이며, 그때는 별도 ADR과 마이그레이션이 필요하다.
- **placeholder 계정으로 소유권 이전** — 파일은 보존되지만, 시딩하고 관리해야 할 가짜 신원을
  새로 만들게 되고, 삭제를 요청한 실제 소유자의 콘텐츠를 엉뚱한 주체에 귀속시킨다.
- **무조건 연쇄 삭제(플래그 없음)** — 변경량이 가장 적고, 프론트가 정상 동작하는 한 의도한
  흐름 그대로다. 기각 이유: 경고가 오직 프론트에만 존재하게 되어, 다른 클라이언트에서 잘못
  나간 요청 하나가 아무런 중간 신호 없이 계정의 전체 라이브러리를 비가역적으로 파괴한다.
- **항상 거절(409만, 연쇄 경로 없음)** — 가장 안전하고 저렴하며 동작을 정의하기는 한다. 전체
  답으로는 기각: "계정을 삭제한다"가 여러 단계의 잡일이 되고, 자기 데이터를 지우려는 사용자
  입장에서는 데이터가 그대로 남는다.
- **연쇄를 본인 삭제로만 제한(관리자는 항상 409)** — 한 단계 더 보수적이지만, 파일이 많은
  스팸 계정 정리 같은 통상적 운영을 N+1 요청으로 만들면서 얻는 보안 이득이 없다. 관리자는
  이미 그 파일들을 하나씩 지울 수 있고, 어느 쪽이든 감사 로그에 남는다.

## 결과

- `DELETE /user/:id`에 클라이언트가 처리해야 할 결과가 둘 늘었다: **409 `USER_HAS_FILES`**,
  그리고 `"true"`/`"false"`가 아닌 플래그에 대한 **400 `VALIDATION_FAILED`**.
  `USER_HAS_FILES`는 동결된 카탈로그([ADR 0011](0011-error-code-contract.ko.md))에 추가되며,
  코드 추가는 breaking change가 아니다.
- **확인된 경로는 비가역이다.** 파일 행, 계정 행, 물리 바이트가 모두 사라지고 복구 경로는
  없다. 감사 기록은 남는다(`audit_log_entity`는 설계상 FK가 없다 —
  [ADR 0013](0013-rbac-and-audit-log.ko.md)). `USER_DELETE`는 이제 `detail: files=N`을 함께 남긴다.
- **프론트엔드 반영은 프론트 범위의 별도 과제이며 이 변경에서 명시적으로 제외한다.** 경고
  다이얼로그, `deleteFiles=true` 재요청, 409 분기는 자체 CLAUDE.md를 가진 `frontend/`의
  몫이다(CLAUDE.md > Project Overview). 그 작업이 끝나기 전까지 프론트에는 확인을 통과시킬
  계정 삭제 흐름이 없다.
- **unlink 실패는 이제 에러가 아니라 경고 로그다.** 그 목적으로 `FileService`와
  `UserService`에 `Logger`를 추가했다(`warn` = 성능·상태 저하,
  [ADR 0017](0017-logging-conventions.ko.md)). 따라서 `file/upload`에 고아 바이트가 남을 수
  있는 경우는 둘 — unlink 실패와 위의 동시 삽입 경합 — 이고, 그 폴더를 훑는 장치는 없다.
  `granted_` sweep을 여기서 도입하지 않은 것은 의도적이다. `file/temp`와 달리 "행 없이 디스크에
  있다"는 판정을 파일명만으로 내릴 수 없으므로 DB 조인을 포함한 별도 설계가 필요하다.
- `unlinkStoredFiles`(`backend/common/`)는 `file/upload/` 바깥의 경로를 거부한다. 이는 방어적
  덧칠이 아니라 실제로 도달 가능한 분기다. `UpdateFileDto`는 폴더 없는 맨 `granted_` 이름을
  허용하므로 행이 그런 경로를 정당하게 가질 수 있고, unlink가 그 경로를 따라 저장 루트 밖으로
  나가서는 안 된다.
- `UserModule` → `FileModule` 의존이 새로 생겼다(순환 없음: `FileModule`은 `UserModule`이
  아니라 `UserEntity` 리포지토리에 의존한다).
- 테스트 계정을 그냥 지우던 개발 편의는 그 계정이 파일을 보유한 경우 사라진다. 이제 플래그가
  요청의 일부다.
