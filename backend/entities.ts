// Purpose: the single registration list of every TypeORM entity in this project.
// Usage: imported by app.module.ts (TypeOrmModule `entities`) and backend/data-source.ts (the migration CLI DataSource); a new entity is added here and nowhere else.
// Rationale: the two lists were maintained separately, and migration:generate reads only the CLI one — adding CommentEntity to app.module.ts alone made generate report success while silently omitting the whole table (2026-07-31).

import { FileEntity } from './file/entity/file.entity';
import { UserEntity } from './user/entity/user.entity';
import { AuditLogEntity } from './audit-log/audit-log.entity';
import { PostEntity } from './post/entity/post.entity';
import { CommentEntity } from './comment/entity/comment.entity';

// Explicit rather than a glob: this project registers entities by name on purpose
// (Architecture Decisions > Database), so the fix for the duplicated lists is to have
// exactly one list — not to replace naming with a filesystem rule.
export const ENTITIES = [
  FileEntity,
  UserEntity,
  AuditLogEntity,
  PostEntity,
  CommentEntity,
];
