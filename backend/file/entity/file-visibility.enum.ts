// 목적: 파일에 저장된 바이트로의 접근을 통제하는 3단계 공개범위 enum.
// 사용처: FileEntity.visibility, FileService의 접근 검사, UpdateFileDto에서 임포트한다.
// 근거: ADR 0025 D1은 boolean isPublic으로는 표현 못 할 세 번째 상태 "unlisted"가 필요하다 —
// varchar 기반 TS enum은 기존 UserRole 컨벤션(backend/auth/role/role.ts)과 맞춘 것이다.

export enum FileVisibility {
  public = 'public',
  private = 'private',
  unlisted = 'unlisted',
}
