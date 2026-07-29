import { OmitType, PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { UploadFileDto } from './create-uploadFile.dto';

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
}
