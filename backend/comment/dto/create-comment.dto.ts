// 목적: POST /post/:postId/comment의 본문 — 댓글 텍스트 하나만 검증한다.
// 사용처: PostCommentController.create()에서 @Body()로 바인딩되어 CommentService.create()로 전달된다.
// 근거: 전역 파이프는 DTO가 선언한 것만 남기고, 엔티티에는 길이 제한이 없다 — ADR 0023의 ≤1,000 제한이 여기 있어야 한다. postId는 라우트에서, creatorId는 토큰에서 오므로 둘 다 body에 있으면 안 된다.

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
