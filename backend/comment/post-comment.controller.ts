// 목적: 게시글에 매달린 스레드 라우트(/post/:postId/comment)를 JwtAuthGuard 뒤에 노출한다.
// 사용처: CommentModule이 라우팅; 모든 판단은 CommentService에 위임하고 신원은 JWT에서만 가져온다.
// 근거: ADR 0023은 목록 조회와 생성을 게시글 경로 아래에, 수정과 삭제는 /comment/:id에 둔다 — 두 프리픽스는 @Controller 하나로 공유할 수 없고, PostController는 모듈 경계를 넘어 CommentService를 임포트하지 않는 한 이걸 호스팅할 수 없다.

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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CommentService } from './comment.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { GetCommentsDto } from './dto/get-comments.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { UserId } from 'backend/user/decorator/userId.decorator';

@Controller('post/:postId/comment')
@ApiTags('댓글 API (Comment API)')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class PostCommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get()
  @ApiOperation({
    summary: '한 게시글의 댓글 목록을 조회한다. (List comments on one post.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '한 게시글에 대한 [comments, totalCount] 튜플. 오래된 순(createdAt ASC, id ' +
      '타이브레이커)으로 정렬된다 — 최신순인 파일·게시글 목록과 달리 스레드는 쓰인 ' +
      '순서로 읽힌다. take/skip으로 페이지네이션하며, 정렬은 고정이고 정렬 파라미터를 ' +
      '받지 않는다(ADR 0023). (A [comments, totalCount] tuple for one post. Ordered ' +
      'oldest-first (createdAt ASC, id as tiebreaker) — a thread reads in the order it ' +
      'was written, unlike the newest-first file and post lists. take/skip paginate; the ' +
      'order is fixed and takes no sort parameters (ADR 0023).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take가 1–100 범위를 벗어나거나 skip이 음수다. ' +
      '(VALIDATION_FAILED — take is out of 1–100, or skip is negative.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'POST_NOT_FOUND — 존재하지 않는 게시글이다. (POST_NOT_FOUND — no such post.)',
  })
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
  @ApiOperation({
    summary: '댓글을 생성한다. (Create a comment.)',
  })
  @ApiResponse({
    status: 201,
    description:
      '댓글이 생성됐다. 댓글에는 자연스러운 멱등키가 없어 동일 재제출도 두 번째 댓글을 ' +
      '만든다 — fileId 없는 게시글과 마찬가지로 문서화된 채 수용된 동작이다(ADR 0023 ' +
      'D1). (The comment was created. A comment has no natural idempotency key, so an ' +
      'identical resubmission creates a second comment — documented and accepted, as for ' +
      'a post with no fileId (ADR 0023 D1).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — body가 비어 있거나 1,000자를 초과한다. ' +
      '(VALIDATION_FAILED — body is empty or exceeds 1,000 characters.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'POST_NOT_FOUND — 존재하지 않는 게시글이다. (POST_NOT_FOUND — no such post.)',
  })
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
