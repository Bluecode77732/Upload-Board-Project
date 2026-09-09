// 목적: PATCH /post/:id 요청 본문 — 게시글에서 수정 가능한 필드만 검증한다.
// 사용처: PostController.update()에서 @Body()로 바인딩되어 PostService.update()로 전달된다.
// 근거: fileId는 CreatePostDto로부터 상속되면 안 되므로, 그대로 재사용하지 않고 OmitType으로 형태를 도출한다.

import { OmitType, PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

// fileId를 상속하지 않고 생략한다: 첨부는 생성 시점에 고정되므로
// (ADR 0023 D1), 여기서 받아들이면 조용히 claim 표면이 하나 더 생긴다.
// 동영상을 떼어내려면 게시글 자체를 삭제해야 한다.
export class UpdatePostDto extends PartialType(
  OmitType(CreatePostDto, ['fileId'] as const),
) {}
