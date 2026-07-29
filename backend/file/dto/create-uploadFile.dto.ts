import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

// The exact shape upload.module.ts issues: temp_{uuid}_{ms-timestamp}.{ext}. Pinning it
// here makes the filename a one-shot claim token (ADR 0019) and keeps client-chosen path
// segments ('../', absolute paths) out of the rename in FileService.uploadFile.
// Case-insensitive: the stored extension keeps the original filename's casing.
export const TEMP_FILENAME_PATTERN =
  /^temp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_\d+\.(mp4|mov|webm)$/i;

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
}
