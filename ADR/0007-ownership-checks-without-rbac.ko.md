# ADR 0007: RBAC 없는 소유권 검사

- 상태: 승인됨
- 날짜: 2026-07-22
- English: [0007-ownership-checks-without-rbac.md](0007-ownership-checks-without-rbac.md)

## 맥락

이 결정 전까지 인증된 모든 사용자가 *어떤* 사용자 계정이든 *어떤* 파일이든 수정·삭제할
수 있었습니다 — `JwtAuthGuard`는 신원만 증명할 뿐 소유권은 아무것도 확인하지
않았습니다. 완전한 해결책(RBAC: role 컬럼 + role 인식 가드)은 스키마 변경이 필요하며,
이는 마이그레이션 도입에 막혀 있습니다
([ADR 0006](0006-schema-policy-and-migration-adoption.ko.md)).

## 결정

role 없이 지금 소유권 검사를 도입합니다. 스키마 변경이 필요 없는 핸들러/서비스 레벨
가드로 구현하며, RBAC은 별도의 확정된 로드맵 항목으로 남습니다.

- **본인만 사용자 쓰기**: `PATCH /user/:id`와 `DELETE /user/:id`는 `@UserId()`
  (`request.user.id`의 JWT 신원)와 경로 id를 비교해 불일치 시 `ForbiddenException`을
  던집니다 (`src/user/user.controller.ts`).
- **작성자만 파일 쓰기**: `FileService.updateFile`/`deleteFile`은 `creator` 관계를
  로드해 파일 작성자가 아닌 요청자를 거부합니다 (`src/file/file.service.ts`).
  `UpdateFileDto.userId`를 통한 소유권 *재할당*도 마찬가지로 작성자만 가능합니다.
- 신원은 항상 검증된 JWT에서 옵니다 — 요청 페이로드에서 오는 일은 없습니다
  (`@UserId` 데코레이터가 공인된 접근자).

## 결과

- 스키마를 건드리지 않고, 인증만 되면 아무 리소스나 수정할 수 있던 허점이
  닫혔습니다.
- 관리자 기능은 여전히 없습니다 — 누구도 다른 사용자의 콘텐츠를 관리·제재할 수
  없습니다.
  그것이 RBAC 로드맵 항목이며, 이 검사들을 *대체*하는 것이 아니라 그 *위에* 얹힐
  예정입니다.
- 파일 소유권 검사는 서비스에 있고(트랜잭션이 이미 행을 로드함), 사용자 본인 검사는
  컨트롤러에 있습니다(추가 쿼리 불필요). 미래의 RBAC 가드가 위치를 통일해야 합니다.
