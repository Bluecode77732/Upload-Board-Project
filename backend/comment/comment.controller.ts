// 목적: 댓글 단건 라우트(/comment/:id)를 JwtAuthGuard 뒤에 노출하고 Swagger 문서를 붙인다.
// 사용처: CommentModule이 라우팅; 모든 판단은 CommentService에 위임하고 신원은 JWT에서만 가져온다.
// 근거: ADR 0023은 기존 댓글을 post 경유가 아니라 자기 id로 지칭한다 — 수정/삭제에 postId가 필요 없고, 요구하면 클라이언트가 댓글이 속하지 않은 post를 임의로 지정할 여지가 생긴다.

import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
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
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';

@Controller('comment')
@ApiTags('댓글 API (Comment API)')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Patch(':id')
  @ApiOperation({
    summary: '댓글을 수정한다. (Update a comment.)',
  })
  @ApiResponse({
    status: 200,
    description: '댓글이 수정됐다. (The comment was updated.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 댓글 작성자 또는 admin만 수정할 수 있다. 그 댓글이 달린 ' +
      '게시글의 작성자라고 해서 권한이 생기지 않는다(ADR 0023). (FORBIDDEN_NOT_OWNER — ' +
      'only the comment author or an admin may edit it. The author of the post it sits ' +
      'on gains no power over it (ADR 0023).)',
  })
  @ApiResponse({
    status: 404,
    description:
      'COMMENT_NOT_FOUND — 존재하지 않는 댓글이다. (COMMENT_NOT_FOUND)',
  })
  // 목적: 본문 수정 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 작성자 본인인지 admin인지는 역할까지 있어야 판정되며, 그 정보는 오직 토큰에서 와야 한다.
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다.
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCommentDto: UpdateCommentDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.commentService.update(id, updateCommentDto, actor);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '댓글을 삭제한다. (Delete a comment.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '댓글이 비가역적으로 삭제됐다. 게시글은 그대로 남는다 — 댓글은 게시글에 매달려 ' +
      '있을 뿐 그 일부가 아니다. (The comment is gone, irreversibly. Its post is ' +
      'untouched — a comment hangs off a post, it is not part of one.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 댓글 작성자 또는 admin만 삭제할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the comment author or an admin may delete it.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'COMMENT_NOT_FOUND — 존재하지 않는 댓글이다. (COMMENT_NOT_FOUND)',
  })
  // 목적: 삭제 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 하드 삭제는 비가역이므로 작성자/admin 판정이 반드시 선행돼야 한다(ADR 0020).
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.commentService.deleteComment(id, actor);
  }
}
