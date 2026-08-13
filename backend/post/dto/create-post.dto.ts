// Purpose: validates the POST /post body — post text plus the optional id of a file to attach.
// Usage: bound via @Body() in PostController.create(); forwarded whole to PostService.create().
// Rationale: the global pipe only strips what a DTO declares, and the entity bounds no length — the ADR 0023 limits (title ≤100, body ≤10,000) have to live here.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Post title. Not unique — two authors may use the same one.',
    maxLength: 100,
    example: 'My holiday clip',
  })
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  @ApiProperty({
    description: 'Post body.',
    maxLength: 10000,
    example: 'Filmed this last weekend.',
  })
  body!: string;

  // Fixed at creation on purpose: PATCH cannot move an attachment, which would open a
  // second claim/replay surface on a route that has no requirement for one (ADR 0023 D1).
  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description:
      'Id of a file to attach. Must be a file the requester created, and one no other post already holds. Omit for a text-only post.',
    minimum: 1,
    example: 12,
  })
  fileId?: number;
}
