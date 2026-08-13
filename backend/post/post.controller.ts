// Purpose: exposes the board post REST surface (/post) behind JwtAuthGuard and documents it for Swagger.
// Usage: routed by PostModule; delegates every decision to PostService and derives identity from the JWT only.
// Rationale: ADR 0023 fixes these five routes; FileController could not host them without merging file metadata with board content.

import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PostService } from './post.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { UserId } from 'backend/user/decorator/userId.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';

@Controller('post')
@ApiTags('Post API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      'A [posts, totalCount] tuple. Defaults to the 20 newest posts (createdAt DESC); take/skip paginate, search matches the title, creatorId filters by author, sortBy/order sort (ADR 0021).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take is out of 1–100, skip is negative, search exceeds 100 characters, or sortBy/order is not one of the accepted values.',
  })
  // 목적: 검증된 목록 조회 조건을 DTO 한 덩어리로 서비스에 넘긴다.
  // 이유: 조건이 페이지네이션·검색·정렬·필터로 여러 개라, 위치 인자로 풀면 호출부가 인자 순서 실수에 노출된다.
  // 방법: @Query()로 바인딩된 GetPostsDto를 그대로 전달한다 — 컨트롤러는 조회 조건을 해석하지 않는다.
  getPosts(@Query() getPostsDto: GetPostsDto) {
    return this.postService.getPosts(getPostsDto);
  }

  @Get(':id')
  @ApiResponse({
    status: 200,
    description: 'The post, its author, and its attached file.',
  })
  @ApiResponse({ status: 404, description: 'POST_NOT_FOUND' })
  // 목적: 단건 조회 요청을 서비스로 넘긴다.
  // 이유: 상세 화면은 목록에 담기지 않는 본문 전체를 필요로 한다.
  // 방법: 경로 파라미터를 ParseIntPipe로 좁혀 그대로 전달한다.
  getPostById(@Param('id', ParseIntPipe) id: number) {
    return this.postService.getPostById(id);
  }

  @Post()
  @ApiResponse({ status: 201, description: 'The post was created.' })
  @ApiResponse({
    status: 200,
    description:
      'Idempotent replay: the same author already created this exact post for this file, so the existing post is returned unchanged (ADR 0023 D1).',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — fileId refers to a file the requester did not create.',
  })
  @ApiResponse({ status: 404, description: 'FILE_NOT_FOUND — no such fileId.' })
  @ApiResponse({
    status: 409,
    description:
      'POST_FILE_TAKEN — the file is already attached to a post and this submission is not an identical retry.',
  })
  // 목적: 게시글 생성 요청을 서비스로 넘기고, 멱등 재시도는 200으로 응답한다.
  // 이유: 재시도가 새 리소스를 만든 것처럼 201을 돌려주면 클라이언트가 생성/재생을 구분할 수 없다.
  // 방법: 서비스가 돌려준 replayed 플래그로만 상태코드를 바꾸고(@Res passthrough), 본문은 동일하게 반환한다.
  async create(
    @Body() createPostDto: CreatePostDto,
    @UserId() userId: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { replayed, post } = await this.postService.create(
      createPostDto,
      userId,
    );

    if (replayed) {
      response.status(HttpStatus.OK);
    }

    return post;
  }

  @Patch(':id')
  @ApiResponse({ status: 200, description: 'The post was updated.' })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the author or an admin may edit a post.',
  })
  @ApiResponse({ status: 404, description: 'POST_NOT_FOUND' })
  // 목적: 본문 수정 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 작성자 본인인지 admin인지는 역할까지 있어야 판정되며, 그 정보는 오직 토큰에서 와야 한다.
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다 — 본문에 실린 식별자는 신뢰하지 않는다.
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePostDto: UpdatePostDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.postService.update(id, updatePostDto, actor);
  }

  @Delete(':id')
  @ApiResponse({
    status: 200,
    description:
      'The post is gone, irreversibly. Its attached file row and stored file are left untouched — a post references a file, it does not own it.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the author or an admin may delete a post.',
  })
  @ApiResponse({ status: 404, description: 'POST_NOT_FOUND' })
  // 목적: 삭제 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 하드 삭제는 비가역이므로 작성자/admin 판정이 반드시 선행돼야 한다(ADR 0020).
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.postService.deletePost(id, actor);
  }
}
