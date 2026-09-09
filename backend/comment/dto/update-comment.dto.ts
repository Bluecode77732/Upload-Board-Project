// 목적: PATCH /comment/:id의 본문 — 댓글에서 수정 가능한 부분만 검증한다.
// 사용처: CommentController.update()에서 @Body()로 바인딩되어 CommentService.update()로 전달된다.
// 근거: body가 유일하게 수정 가능한 필드라, CreateCommentDto에 PartialType을 적용해 ≤1,000 제한을 한곳에만 두고 반복하지 않는다.

import { PartialType } from '@nestjs/swagger';
import { CreateCommentDto } from './create-comment.dto';

// UpdatePostDto와 달리 아무것도 생략하지 않는다: CreateCommentDto는 `body`만 갖고 있고,
// 댓글은 다른 게시글로 옮길 수 없다(그건 수정이 아니라 새 댓글이 된다).
export class UpdateCommentDto extends PartialType(CreateCommentDto) {}
