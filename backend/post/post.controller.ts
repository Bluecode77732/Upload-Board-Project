// 목적: JwtAuthGuard 뒤에서 게시판 게시글 REST 표면(/post)을 노출하고 Swagger로 문서화한다.
// 사용처: PostModule이 라우팅하며, 모든 판단은 PostService에 위임하고 신원은 오직 JWT에서만 얻는다.
// 근거: ADR 0023이 이 다섯 개 라우트를 확정했다 — 파일 메타데이터와 게시판 내용을 섞지 않고서는 FileController가 이들을 담을 수 없었다.

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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PostService } from './post.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { UserId } from 'backend/user/decorator/userId.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';

@Controller('post')
@ApiTags('게시글 API (Post API)')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get()
  @ApiOperation({
    summary: '게시글 목록을 조회한다. (List posts.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '[posts, totalCount] 튜플. 기본값은 최신 20건(createdAt DESC)이며, take/skip으로 ' +
      '페이지네이션하고, search는 제목을 매칭하며, creatorId는 작성자로 필터링하고, ' +
      'sortBy/order로 정렬한다(ADR 0021). (A [posts, totalCount] tuple. Defaults to the ' +
      '20 newest posts (createdAt DESC); take/skip paginate, search matches the title, ' +
      'creatorId filters by author, sortBy/order sort (ADR 0021).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take가 1–100 범위를 벗어나거나, skip이 음수이거나, ' +
      'search가 100자를 초과하거나, sortBy/order가 허용된 값이 아니다. ' +
      '(VALIDATION_FAILED — take is out of 1–100, skip is negative, search exceeds 100 ' +
      'characters, or sortBy/order is not one of the accepted values.)',
  })
  // 목적: 검증된 목록 조회 조건을 DTO 한 덩어리로 서비스에 넘긴다.
  // 이유: 조건이 페이지네이션·검색·정렬·필터로 여러 개라, 위치 인자로 풀면 호출부가 인자 순서 실수에 노출된다.
  // 방법: @Query()로 바인딩된 GetPostsDto를 그대로 전달한다 — 컨트롤러는 조회 조건을 해석하지 않는다.
  getPosts(@Query() getPostsDto: GetPostsDto) {
    return this.postService.getPosts(getPostsDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: '게시글 단건을 조회한다. (Get one post.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '게시글과 작성자, 첨부 파일. (The post, its author, and its attached file.)',
  })
  @ApiResponse({
    status: 404,
    description: 'POST_NOT_FOUND — 존재하지 않는 게시글이다. (POST_NOT_FOUND)',
  })
  // 목적: 단건 조회 요청을 서비스로 넘긴다.
  // 이유: 상세 화면은 목록에 담기지 않는 본문 전체를 필요로 한다.
  // 방법: 경로 파라미터를 ParseIntPipe로 좁혀 그대로 전달한다.
  getPostById(@Param('id', ParseIntPipe) id: number) {
    return this.postService.getPostById(id);
  }

  @Post()
  @ApiOperation({
    summary: '게시글을 생성한다. (Create a post.)',
  })
  @ApiResponse({
    status: 201,
    description: '게시글이 생성됐다. (The post was created.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '멱등 재생: 같은 작성자가 이 파일에 이미 동일한 게시글을 만들었으므로 기존 ' +
      '게시글을 그대로 반환한다(ADR 0023 D1). (Idempotent replay: the same author ' +
      'already created this exact post for this file, so the existing post is returned ' +
      'unchanged (ADR 0023 D1).)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — fileId가 요청자가 만들지 않은 파일을 가리킨다. ' +
      '(FORBIDDEN_NOT_OWNER — fileId refers to a file the requester did not create.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 fileId다. (FILE_NOT_FOUND — no such fileId.)',
  })
  @ApiResponse({
    status: 409,
    description:
      'POST_FILE_TAKEN — 이 파일이 이미 다른 게시글에 첨부돼 있고, 이 요청은 동일 ' +
      '재시도가 아니다. (POST_FILE_TAKEN — the file is already attached to a post and ' +
      'this submission is not an identical retry.)',
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
  @ApiOperation({
    summary: '게시글을 수정한다. (Update a post.)',
  })
  @ApiResponse({
    status: 200,
    description: '게시글이 수정됐다. (The post was updated.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 작성자 또는 admin만 게시글을 수정할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the author or an admin may edit a post.)',
  })
  @ApiResponse({
    status: 404,
    description: 'POST_NOT_FOUND — 존재하지 않는 게시글이다. (POST_NOT_FOUND)',
  })
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
  @ApiOperation({
    summary: '게시글을 삭제한다. (Delete a post.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '게시글이 비가역적으로 삭제됐다. 첨부 파일 행과 저장된 실물은 그대로 남는다 — ' +
      '게시글은 파일을 참조할 뿐 소유하지 않는다. (The post is gone, irreversibly. Its ' +
      'attached file row and stored file are left untouched — a post references a file, ' +
      'it does not own it.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 작성자 또는 admin만 게시글을 삭제할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the author or an admin may delete a post.)',
  })
  @ApiResponse({
    status: 404,
    description: 'POST_NOT_FOUND — 존재하지 않는 게시글이다. (POST_NOT_FOUND)',
  })
  // 목적: 삭제 요청을 권한 판정이 가능한 형태로 서비스에 넘긴다.
  // 이유: 하드 삭제는 비가역이므로 작성자/admin 판정이 반드시 선행돼야 한다(ADR 0020).
  // 방법: @AuthUser로 { id, role }을 받아 그대로 전달한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.postService.deletePost(id, actor);
  }
}
