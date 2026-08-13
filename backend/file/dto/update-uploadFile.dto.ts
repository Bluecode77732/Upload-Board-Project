import { OmitType, PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { UploadFileDto } from './create-uploadFile.dto';
import { FileVisibility } from '../entity/file-visibility.enum';

// filePath is omitted from the inherited shape rather than inherited: the two endpoints
// sit on opposite sides of the prefix state machine (ADR 0003) — POST /file takes an
// unclaimed `temp_` filename, PATCH takes an already-promoted `granted_` one — so
// inheriting the temp_ pattern would reject every legitimate update.
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
  @IsNumber()
  @ApiPropertyOptional({
    description: 'Reassign file to a different user',
    example: 2,
  })
  userId?: number;

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
