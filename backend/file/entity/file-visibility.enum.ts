// Purpose: the three-tier file visibility enum gating access to a file's stored bytes.
// Usage: imported by FileEntity.visibility, FileService's access checks, and UpdateFileDto.
// Rationale: ADR 0025 D1 needs a third "unlisted" state a boolean isPublic cannot express; a
// varchar-backed TS enum matches the existing UserRole convention (backend/auth/role/role.ts).

export enum FileVisibility {
  public = 'public',
  private = 'private',
  unlisted = 'unlisted',
}
