// Purpose: owns board comment business logic — the thread listing, CRUD, ownership checks, and the account-cascade delete.
// Usage: injected by PostCommentController and CommentController; deleteCommentsOfCreator is called by UserService inside its deletion transaction.
// Rationale: ADR 0023 gives comment its own module; folding it into PostService would put a post's own text and the thread under it in one service, and would make the account cascade reach across two row types from one place.

import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CommentEntity } from './entity/comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { GetCommentsDto } from './dto/get-comments.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { PostService } from 'backend/post/post.service';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';

// The acting user's identity + role (from the JWT), enough for creator-OR-admin checks.
interface Requester {
  id: number;
  role: UserRole;
}

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(CommentEntity)
    private readonly commentRepository: Repository<CommentEntity>,

    private readonly postService: PostService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // A comment is manageable by its author, or by an admin/superadmin (RBAC, ADR 0013).
  // Deliberately NOT "or the author of the post it sits on": that third axis would need a
  // comment.post.creator.id reach-through, and admin moderation already covers the case.
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  // 목적: CommentEntity를 외부 응답 형태로 변환한다.
  // 이유: 엔티티는 순수 DB 모델이어야 하고, 스레드 한 화면에 게시글 본문과 파일 URL이 행마다 반복되면 안 된다.
  // 방법: 작성자는 로드된 경우에만 붙이고, 게시글은 임베드하지 않는다. postId는 인자로 받는다 —
  //       목록은 라우트에서, 단건은 로드된 관계에서 오므로 목록이 쓰지도 않을 조인을 하지 않아도 된다.
  private toResponse(
    comment: CommentEntity,
    postId: number,
  ): CommentResponseDto {
    return {
      id: comment.id,
      body: comment.body,
      postId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      ...(comment.creator && {
        creator: { id: comment.creator.id, email: comment.creator.email },
      }),
    };
  }

  // 목적: 한 게시글의 댓글을 오래된 순으로 페이지네이션해 조회한다.
  // 이유: 목록 엔드포인트는 전량 스캔이 금지돼 있고(Never Do G2), ORDER BY가 없으면 페이지 간 행 중복·누락이 생긴다.
  // 방법: 글 존재를 PostService에 먼저 확인해 없으면 404를 내고, creator만 조인해 createdAt ASC + id ASC로 정렬한다.
  //       정렬은 고정이다 — 스레드는 오래된 것부터 읽으므로 sortBy/order를 열지 않는다(ADR 0023).
  async getComments(
    postId: number,
    query: GetCommentsDto,
  ): Promise<[CommentResponseDto[], number]> {
    await this.postService.assertPostExists(postId);

    const [comments, count] = await this.commentRepository
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.creator', 'creator')
      .where('comment.postId = :postId', { postId })
      .orderBy('comment.createdAt', 'ASC')
      // A unique tiebreaker keeps the page boundary deterministic when two comments
      // share a timestamp — the same defect ADR 0021 fixed for the file listing.
      .addOrderBy('comment.id', 'ASC')
      .take(query.take)
      .skip(query.skip)
      .getManyAndCount();

    // postId is known from the route, so the post relation is never joined — that join
    // would repeat one post's row across every comment in the thread for no gain.
    return [comments.map((comment) => this.toResponse(comment, postId)), count];
  }

  // 목적: 댓글 한 건을 작성자와 함께 조회한다.
  // 이유: 생성·수정 직후의 응답과 권한 판정이 같은 조회 경로를 쓰면 표현이 갈라지지 않는다.
  // 방법: creator와 post를 조인해 없으면 404 COMMENT_NOT_FOUND를 던진다.
  private async findOneOrThrow(id: number): Promise<CommentEntity> {
    const comment = await this.commentRepository.findOne({
      where: { id },
      relations: ['creator', 'post'],
    });

    if (!comment) {
      throw new NotFoundException({
        code: ErrorCode.COMMENT_NOT_FOUND,
        message: 'No comment found.',
      });
    }

    return comment;
  }

  // 목적: 단일 댓글을 조회해 응답 형태로 돌려준다.
  // 이유: 생성·수정 직후의 응답이 같은 조회 경로를 공유해야 표현이 갈라지지 않는다.
  // 방법: 공통 조회 경로를 그대로 쓰고 변환만 얹는다. ADR 0023의 라우트 표에 단건 조회가 없으므로
  //       private이다 — 결정되지 않은 엔드포인트를 여는 것은 범위 밖이다.
  private async getCommentById(id: number): Promise<CommentResponseDto> {
    const comment = await this.findOneOrThrow(id);
    return this.toResponse(comment, comment.post.id);
  }

  // 목적: 특정 게시글에 댓글을 단다.
  // 이유: 게시판의 기본 상호작용이며, 없는 글에 달린 댓글은 FK 위반 500이 아니라 404로 거절돼야 한다.
  // 방법: 글 존재를 PostService에 먼저 확인한 뒤 단일 insert(트랜잭션 표 Row 1). 댓글에는 자연 멱등 키가
  //       없으므로 재제출은 두 번째 댓글이 된다 — ADR 0023 D1이 fileId 없는 글에 내린 것과 같은 수용이다.
  async create(
    postId: number,
    dto: CreateCommentDto,
    userId: number,
  ): Promise<CommentResponseDto> {
    await this.postService.assertPostExists(postId);

    const inserted = await this.commentRepository
      .createQueryBuilder()
      .insert()
      .into(CommentEntity)
      .values({
        body: dto.body,
        creator: { id: userId },
        post: { id: postId },
      })
      .execute();

    const identifier: unknown = inserted.identifiers[0]?.id;
    if (typeof identifier !== 'number') {
      throw new InternalServerErrorException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Comment could not be created.',
      });
    }

    // Re-read through the shared path: the insert result carries no relations, so a
    // response composed from it would omit the author email.
    return this.getCommentById(identifier);
  }

  // 목적: 댓글 본문을 수정한다.
  // 이유: 오타·내용 정정은 게시판의 기본 요구이고, 다른 글로 옮기는 것은 수정이 아니라 새 댓글이다.
  // 방법: 작성자 또는 admin인지 확인한 뒤 body만 반영한다(단일 쓰기 — 트랜잭션 표 Row 1).
  async update(
    id: number,
    dto: UpdateCommentDto,
    requester: Requester,
  ): Promise<CommentResponseDto> {
    const comment = await this.findOneOrThrow(id);

    if (!this.canManage(comment.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the comment author or an admin can update this comment.',
      });
    }

    // An empty PATCH is a no-op, not an error — TypeORM rejects an empty update set.
    if (dto.body !== undefined) {
      await this.commentRepository.update({ id }, { body: dto.body });
    }

    return this.getCommentById(id);
  }

  // 목적: 댓글 한 건을 삭제하고 그 사실을 감사 로그에 남긴다.
  // 이유: 이 프로젝트의 삭제는 전부 하드 삭제라 되돌릴 수 없고(ADR 0020), 타인 자원에 대한 admin 권한은
  //       추적 가능해야 한다(ADR 0013).
  // 방법: 작성자 또는 admin인지 확인 → 행 삭제(단일 쓰기) → 커밋 뒤 감사 로그. 게시글은 건드리지 않는다.
  async deleteComment(id: number, requester: Requester): Promise<string> {
    const comment = await this.findOneOrThrow(id);

    if (!this.canManage(comment.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the comment author or an admin can delete this comment.',
      });
    }

    await this.commentRepository.delete(id);

    await this.auditLogService.log(
      requester.id,
      id,
      AuditTargetType.comment,
      'COMMENT_DELETE',
    );

    return `Comment ${id} deleted.`;
  }

  // 목적: 한 유저가 쓴 댓글 전부를 호출자의 트랜잭션 안에서 삭제한다.
  // 이유: 계정 삭제 시 그 유저가 *남의 글에* 단 댓글은 게시글 FK 연쇄로 닿지 않으므로 명시적으로 지워야 하고,
  //       댓글의 삭제 규칙은 UserModule이 아니라 CommentModule의 책임이다(모듈 책임 경계, ADR 0023 D5).
  // 방법: id 목록이 아니라 creatorId 기준으로 지운다 — 조회 이후 끼어든 작성분까지 포함해야 경합이 없다.
  //       자기 글에 달린 남의 댓글은 이후 게시글 삭제 시 FK ON DELETE CASCADE가 가져간다.
  async deleteCommentsOfCreator(
    manager: EntityManager,
    creatorId: number,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from(CommentEntity)
      .where('"creatorId" = :creatorId', { creatorId })
      .execute();
  }
}
