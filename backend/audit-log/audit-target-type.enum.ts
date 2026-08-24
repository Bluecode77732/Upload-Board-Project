// Purpose: names what kind of entity an audit record's targetId points at (user/file/post/comment).
// Usage: imported by AuditLogEntity.targetType, AuditLogService.log's callers, and AuditLogService.findAll's user filter.
// Rationale: ADR 0045 — targetId is a polymorphic reference with no discriminator, so a file id equal to
// some user id was returned as that user's activity; a varchar-backed TS enum matches file-media-type.enum.ts.

export enum AuditTargetType {
  user = 'user',
  file = 'file',
  post = 'post',
  comment = 'comment',
}
