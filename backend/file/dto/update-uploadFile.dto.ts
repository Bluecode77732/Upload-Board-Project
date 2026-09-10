import { OmitType, PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';
import { UploadFileDto } from './create-uploadFile.dto';
import { FileVisibility } from '../entity/file-visibility.enum';

// filePath는 상속하지 않고 상속받은 형태에서 제외한다: 두 엔드포인트는 접두사 상태 기계(ADR 0003)의
// 반대편에 있다 — POST /file은 아직 청구되지 않은 `temp_` 파일명을 받고, PATCH는 이미 승격된
// `granted_` 파일명을 받는다 — 그래서 temp_ 패턴을 그대로 물려받으면 정당한 업데이트를 전부 거부하게 된다.
export class UpdateFileDto extends PartialType(
  OmitType(UploadFileDto, ['filePath'] as const),
) {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Already-promoted filename (granted_ prefix)',
    example: 'granted_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
  })
  filePath?: string;

  @IsOptional()
  @IsEnum(FileVisibility)
  @ApiPropertyOptional({
    description:
      "Toggle who can reach GET /file/:id/content. Switching to 'unlisted' generates a share token if the file does not already have one (ADR 0025 D1).",
    enum: FileVisibility,
  })
  visibility?: FileVisibility;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      "Regenerate the share token, invalidating every previously shared link. Only takes effect when the resulting visibility is 'unlisted' (ADR 0025 D3).",
  })
  rotateShareToken?: boolean;

  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({
    description:
      "Optional expiry for the current share token. Only takes effect when the resulting visibility is 'unlisted'; omit for a permanent link (ADR 0025 D3).",
    example: '2026-12-31T00:00:00.000Z',
  })
  shareExpiresAt?: string;
}
