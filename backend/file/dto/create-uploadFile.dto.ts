import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { FileVisibility } from '../entity/file-visibility.enum';

// upload.module.ts가 만들어내는 그 형태 그대로: temp_{uuid}_{ms-timestamp}.{ext}. 이걸 고정해 두면
// 파일명이 1회용 청구 토큰이 되고(ADR 0019), FileService.uploadFile의 rename에 클라이언트가 지정한
// 경로 조각('../', 절대경로 등)이 끼어들 여지가 없어진다.
// 대소문자 구분 없음: 저장된 확장자는 원본 파일명의 대소문자를 그대로 유지한다.
// upload.controller.ts의 세 필드(image/audio/video, ADR 0025 D4/D5)를 모두 커버한다 —
// 필드명이 아니라 확장자 기준 패턴이라, fileFilter 허용목록과 동기화하려고 필드별로
// 분기할 필요가 없다.
export const TEMP_FILENAME_PATTERN =
  /^temp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_\d+\.(jpg|jpeg|png|webp|mp3|mp4|mov|webm)$/i;

export class UploadFileDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'File title',
    example: 'my-video-title',
  })
  title!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(TEMP_FILENAME_PATTERN, {
    message: 'filePath must be a filename returned by POST /upload/attach.',
  })
  @ApiProperty({
    description:
      'Filename returned from POST /upload/attach, echoed back verbatim. Each filename can be claimed once.',
    example: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
  })
  filePath!: string;

  @IsOptional()
  @IsEnum(FileVisibility)
  @ApiPropertyOptional({
    description:
      "Initial visibility for the promoted file. Omit to default to 'private'. Setting 'unlisted' generates a share token at creation (ADR 0025 D1).",
    enum: FileVisibility,
  })
  visibility?: FileVisibility;
}
