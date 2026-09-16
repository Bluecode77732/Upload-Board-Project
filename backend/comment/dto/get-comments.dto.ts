// 목적: GET /post/:postId/comment 쿼리 — 페이지네이션만 제한한다.
// 사용처: PostCommentController.getComments()에서 @Query()로 바인딩되어 CommentService.getComments()로 전달된다.
// 근거: 목록 엔드포인트는 페이지네이션이 필수지만(Never Do G2), ADR 0023이 이 스레드의 정렬을 createdAt ASC로 고정했으므로, GetPostsDto와 달리 sortBy/order/search는 의도적으로 선언하지 않는다.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetCommentsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: '반환할 댓글 개수. (Number of comments to return.)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: '건너뛸 댓글 개수. (Number of comments to skip.)',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;
}
