// Purpose: the three-way classification of a granted file's content, used to pick a playback tag.
// Usage: imported by FileEntity.mediaType, FileService.uploadFile's extension-derivation, and FileResponseDto.
// Rationale: ADR 0040 needs a persisted signal the frontend can branch a <img>/<audio>/<video> tag on; a
// varchar-backed TS enum matches the existing FileVisibility convention (file-visibility.enum.ts).

export enum FileMediaType {
  image = 'image',
  audio = 'audio',
  video = 'video',
}
