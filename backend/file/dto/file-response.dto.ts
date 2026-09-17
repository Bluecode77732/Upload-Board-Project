import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FileVisibility } from '../entity/file-visibility.enum';
import { FileMediaType } from '../entity/file-media-type.enum';

export class FileResponseDto {
  @ApiProperty({ description: '파일 id. (File id.)' })
  id: number;

  @ApiProperty({ description: '파일 제목. (File title.)' })
  title: string;

  @ApiProperty({
    description:
      '콘텐츠 엔드포인트 URL(GET /file/:id/content) — 정적 경로가 아니다(ADR ' +
      '0025/0026). (The content-endpoint URL (GET /file/:id/content) — not a static ' +
      'path, ADR 0025/0026.)',
  })
  fileUrl: string;

  @ApiProperty({
    enum: FileVisibility,
    description: '공개범위. (Visibility.)',
  })
  visibility: FileVisibility;

  // 콘텐츠가 어떤 재생 태그인지 — 업로드 확장자로부터 서버가 판정한 값이며,
  // 클라이언트가 넘긴 값이 아니다(ADR 0040).
  @ApiProperty({
    enum: FileMediaType,
    description:
      '재생 태그 선택용 미디어 타입 — 업로드 확장자로부터 서버가 판정하며 클라이언트가 ' +
      '넘긴 값이 아니다(ADR 0040). (Media type for playback tag selection — ' +
      'server-derived from the upload extension, never client-supplied, ADR 0040.)',
  })
  mediaType: FileMediaType;

  // 호출자가 이 파일을 관리할 수 있고 현재 unlisted일 때만 존재한다
  // (ADR 0025 D3) — 소유자·admin이 아닌 뷰어에게는 절대 노출하지 않는다.
  @ApiPropertyOptional({
    description:
      '호출자가 이 파일을 관리할 수 있고 현재 unlisted일 때만 존재한다(ADR 0025 D3) ' +
      '— 소유자·admin이 아닌 뷰어에게는 절대 노출하지 않는다. (Present only when the ' +
      'caller can manage this file and it is currently unlisted (ADR 0025 D3) — never ' +
      'exposed to a non-owner/non-admin viewer.)',
  })
  shareUrl?: string;

  @ApiPropertyOptional({
    description: '작성자 요약({id, email}). (Creator summary ({id, email}).)',
  })
  creator?: {
    id: number;
    email: string;
  };

  // 호출자가 이 파일을 관리할 수 있거나 대기중인 이전 대상 본인일 때만 존재한다
  // — 무관한 뷰어에게는 절대 노출하지 않는다(ADR 0050).
  @ApiPropertyOptional({
    description:
      '호출자가 이 파일을 관리할 수 있거나 대기중인 이전 대상 본인일 때만 존재한다 ' +
      '— 무관한 뷰어에게는 절대 노출하지 않는다(ADR 0050). (Present only when the ' +
      'caller can manage this file or is the pending transfer target — never exposed ' +
      'to an unrelated viewer, ADR 0050.)',
  })
  pendingTransferTo?: {
    id: number;
    email: string;
  };

  @ApiPropertyOptional({ description: '생성 시각. (Created timestamp.)' })
  createdAt?: Date;

  @ApiPropertyOptional({ description: '수정 시각. (Updated timestamp.)' })
  updatedAt?: Date;
}
