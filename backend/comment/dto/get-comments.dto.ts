// Purpose: bounds the GET /post/:postId/comment query — pagination only.
// Usage: bound via @Query() in PostCommentController.getComments(); forwarded to CommentService.getComments().
// Rationale: list endpoints must paginate (Never Do G2), but ADR 0023 fixes this thread's order at createdAt ASC, so unlike GetPostsDto there is deliberately no sortBy/order/search to declare.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetCommentsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of comments to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of comments to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;
}
