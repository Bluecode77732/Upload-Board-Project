import { FileVisibility } from '../entity/file-visibility.enum';
import { FileMediaType } from '../entity/file-media-type.enum';

export class FileResponseDto {
  id: number;
  title: string;
  fileUrl: string;
  visibility: FileVisibility;
  // 콘텐츠가 어떤 재생 태그인지 — 업로드 확장자로부터 서버가 판정한 값이며,
  // 클라이언트가 넘긴 값이 아니다(ADR 0040).
  mediaType: FileMediaType;
  // 호출자가 이 파일을 관리할 수 있고 현재 unlisted일 때만 존재한다
  // (ADR 0025 D3) — 소유자·admin이 아닌 뷰어에게는 절대 노출하지 않는다.
  shareUrl?: string;
  creator?: {
    id: number;
    email: string;
  };
  // 호출자가 이 파일을 관리할 수 있거나 대기중인 이전 대상 본인일 때만 존재한다
  // — 무관한 뷰어에게는 절대 노출하지 않는다(ADR 0050).
  pendingTransferTo?: {
    id: number;
    email: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}
