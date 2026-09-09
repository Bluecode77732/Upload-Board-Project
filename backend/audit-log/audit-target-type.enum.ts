// 목적: 감사 로그의 targetId가 가리키는 엔티티 종류(user/file/post/comment)를 명시한다.
// 사용처: AuditLogEntity.targetType, AuditLogService.log 호출부, AuditLogService.findAll의 유저 필터에서 사용.
// 근거: ADR 0045 — targetId는 판별자가 없는 다형적 참조라서, 유저 id와 우연히 같은 파일 id가
// 그 유저의 활동으로 잘못 반환됐다; varchar 기반 TS enum은 file-media-type.enum.ts와 방식을 맞춘 것이다.

export enum AuditTargetType {
  user = 'user',
  file = 'file',
  post = 'post',
  comment = 'comment',
}
