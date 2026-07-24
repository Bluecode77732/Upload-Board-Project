import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

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
  @ApiProperty({
    description: 'Filename returned from POST /upload/attach',
    example: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
  })
  filePath!: string;
}
