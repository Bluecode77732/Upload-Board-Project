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
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CommentService } from './comment.service';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';

@Controller('comment')
@ApiTags('Comment API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Patch(':id')
  @ApiResponse({ status: 200, description: 'The comment was updated.' })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the comment author or an admin may edit it. The author of the post it sits on gains no power over it (ADR 0023).',
  })
  @ApiResponse({ status: 404, description: 'COMMENT_NOT_FOUND' })
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
  @ApiResponse({
    status: 200,
    description:
      'The comment is gone, irreversibly. Its post is untouched — a comment hangs off a post, it is not part of one.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the comment author or an admin may delete it.',
  })
  @ApiResponse({ status: 404, description: 'COMMENT_NOT_FOUND' })
  // 목적: 삭제 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 하드 삭제는 비가역이므로 작성자/admin 판정이 반드시 선행돼야 한다(ADR 0020).
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.commentService.deleteComment(id, actor);
  }
}
