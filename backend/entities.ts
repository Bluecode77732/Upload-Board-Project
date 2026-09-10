// 목적: 이 프로젝트의 모든 TypeORM 엔티티를 등록하는 유일한 목록이다.
// 사용처: app.module.ts(TypeOrmModule `entities`)와 backend/data-source.ts(migration CLI DataSource)가 임포트한다; 새 엔티티는 여기에만 추가하고 다른 곳에는 추가하지 않는다.
// 근거: 원래 두 목록을 따로 관리했는데, migration:generate는 CLI 쪽만 읽는다 — app.module.ts에만 CommentEntity를 추가했더니 generate가 테이블 전체를 조용히 빠뜨리고도 성공을 보고했다 (2026-07-31).

import { FileEntity } from './file/entity/file.entity';
import { UserEntity } from './user/entity/user.entity';
import { AuditLogEntity } from './audit-log/audit-log.entity';
import { PostEntity } from './post/entity/post.entity';
import { CommentEntity } from './comment/entity/comment.entity';

// glob이 아니라 명시적 목록이다: 이 프로젝트는 엔티티를 이름으로 등록하기로 의도적으로
// 정했으므로(Architecture Decisions > Database), 중복 목록 문제의 해법은 목록을 정확히
// 하나만 두는 것이지, 이름 등록 방식을 파일시스템 규칙으로 바꾸는 게 아니다.
export const ENTITIES = [
  FileEntity,
  UserEntity,
  AuditLogEntity,
  PostEntity,
  CommentEntity,
];
