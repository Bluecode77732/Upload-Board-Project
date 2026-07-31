// Purpose: exposes the thread routes that hang off a post (/post/:postId/comment) behind JwtAuthGuard.
// Usage: routed by CommentModule; delegates every decision to CommentService and derives identity from the JWT only.
// Rationale: ADR 0023 puts listing and creating under the post's path while editing and deleting live at /comment/:id — two prefixes cannot share one @Controller, and PostController cannot host these without importing CommentService across a module boundary.

import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CommentService } from './comment.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { GetCommentsDto } from './dto/get-comments.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { UserId } from 'backend/user/decorator/userId.decorator';

@Controller('post/:postId/comment')
@ApiTags('Comment API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class PostCommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      'A [comments, totalCount] tuple for one post. Ordered oldest-first (createdAt ASC, id as tiebreaker) — a thread reads in the order it was written, unlike the newest-first file and post lists. take/skip paginate; the order is fixed and takes no sort parameters (ADR 0023).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take is out of 1–100, or skip is negative.',
  })
  @ApiResponse({ status: 404, description: 'POST_NOT_FOUND — no such post.' })
  // 목적: 한 게시글의 댓글 목록 요청을 서비스로 넘긴다.
  // 이유: 스레드는 글과 함께 읽히므로 경로에 글이 드러나야 하고, 목록은 반드시 페이지네이션돼야 한다.
  // 방법: 경로의 postId와 검증된 페이지 조건 DTO를 그대로 전달한다 — 컨트롤러는 정렬을 해석하지 않는다.
  getComments(
    @Param('postId', ParseIntPipe) postId: number,
    @Query() getCommentsDto: GetCommentsDto,
  ) {
    return this.commentService.getComments(postId, getCommentsDto);
  }

  @Post()
  @ApiResponse({
    status: 201,
    description:
      'The comment was created. A comment has no natural idempotency key, so an identical resubmission creates a second comment — documented and accepted, as for a post with no fileId (ADR 0023 D1).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — body is empty or exceeds 1,000 characters.',
  })
  @ApiResponse({ status: 404, description: 'POST_NOT_FOUND — no such post.' })
  // 목적: 댓글 생성 요청을 서비스로 넘긴다.
  // 이유: 없는 글에 달린 댓글은 FK 위반 500이 아니라 404여야 하고, 그 판정은 서비스 계층의 몫이다.
  // 방법: 글 id는 경로에서, 작성자는 @UserId로 토큰에서 받는다 — 본문에 실린 식별자는 신뢰하지 않는다.
  create(
    @Param('postId', ParseIntPipe) postId: number,
    @Body() createCommentDto: CreateCommentDto,
    @UserId() userId: number,
  ) {
    return this.commentService.create(postId, createCommentDto, userId);
  }
}
