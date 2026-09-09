// 목적: granted 파일 콘텐츠를 세 갈래로 분류해 재생 태그를 고르는 데 쓴다.
// 사용처: FileEntity.mediaType, FileService.uploadFile의 확장자 판정, FileResponseDto에서 임포트한다.
// 근거: ADR 0040은 프런트엔드가 <img>/<audio>/<video> 태그를 분기할 영속 신호가 필요하다 —
// varchar 기반 TS enum은 기존 FileVisibility 컨벤션(file-visibility.enum.ts)과 맞춘 것이다.

export enum FileMediaType {
  image = 'image',
  audio = 'audio',
  video = 'video',
}
