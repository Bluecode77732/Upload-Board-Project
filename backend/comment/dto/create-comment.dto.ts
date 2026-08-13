// Purpose: validates the POST /post/:postId/comment body — the comment text, and nothing else.
// Usage: bound via @Body() in PostCommentController.create(); forwarded to CommentService.create().
// Rationale: the global pipe only keeps what a DTO declares, and the entity bounds no length — ADR 0023's ≤1,000 limit has to live here. postId comes from the route and creatorId from the token, so neither belongs in the body.

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @ApiProperty({
    description: 'Comment body.',
    maxLength: 1000,
    example: 'Great clip — where was this filmed?',
  })
  body!: string;
}
