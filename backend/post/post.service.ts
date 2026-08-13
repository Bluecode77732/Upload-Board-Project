// Purpose: owns board post business logic — CRUD, attachment claim resolution, ownership checks, and the account-cascade delete.
// Usage: injected by PostController; deletePostsOfCreator is called by UserService inside its deletion transaction.
// Rationale: ADR 0023 puts post as its own domain module; folding it into FileModule would merge board content with file metadata, the split the module policy exists to keep.

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { PostEntity } from './entity/post.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { GetPostsDto, PostSortField } from './dto/get-posts.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { FileService } from 'backend/file/file.service';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { ErrorCode } from 'backend/common/error-code';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';

// The acting user's identity + role (from the JWT), enough for creator-OR-admin checks.
interface Requester {
  id: number;
  role: UserRole;
}

// Outcome of a create attempt: `replayed` marks a retry that found its own earlier
// success, so the controller can answer 200 instead of a second 201 (ADR 0023 D1).
export interface PostClaimResult {
  replayed: boolean;
  post: PostResponseDto;
}

// Postgres unique_violation on UQ_post_entity_fileId — a concurrent double-submit
// lost the race, which is a client duplicate rather than a server fault.
const UNIQUE_VIOLATION = '23505';

// The sole bridge from a client sort key to a column (ADR 0021). Typed as a total Record
// over PostSortField, so a key added to POST_SORT_FIELDS without a column here fails to
// compile — the whitelist cannot silently drift out of sync with the query.
const SORT_COLUMN: Record<PostSortField, string> = {
  createdAt: 'post.createdAt',
  title: 'post.title',
  id: 'post.id',
};

@Injectable()
export class PostService {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postRepository: Repository<PostEntity>,

    private readonly fileService: FileService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // A post is manageable by its author, or by an admin/superadmin (RBAC, ADR 0013).
  // Deliberately the same shape as FileService.canManage — the board introduces no
  // new authorization axis, and notably not "post author moderates its comments".
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  // 목적: PostEntity를 외부 응답 형태로 변환한다.
  // 이유: 엔티티는 순수 DB 모델이어야 하고, 첨부 파일의 공개 URL 합성 규칙은 FileModule 소유다.
  // 방법: 관계가 로드된 경우에만 creator/file 필드를 붙이고, 파일 쪽 변환은 fileService.toResponse에 위임한다.
  private toResponse(post: PostEntity): PostResponseDto {
    return {
      id: post.id,
      title: post.title,
      body: post.body,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      ...(post.creator && {
        creator: { id: post.creator.id, email: post.creator.email },
      }),
      ...(post.file && { file: this.fileService.toResponse(post.file) }),
    };
  }

  // 목적: creator와 file을 한 번에 붙인 조회 쿼리 빌더를 만든다.
  // 이유: 목록과 단건이 각자 관계를 로드하면 한쪽이 빠졌을 때 N+1이 조용히 생긴다.
  // 방법: 두 관계 모두 leftJoinAndSelect로 미리 붙인 빌더를 반환해 호출부가 조건만 얹게 한다.
  private baseQuery(): SelectQueryBuilder<PostEntity> {
    return this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.creator', 'creator')
      .leftJoinAndSelect('post.file', 'file');
  }

  // 목적: 게시글 목록을 검색·작성자 필터·화이트리스트 정렬·페이지네이션과 함께 조회한다.
  // 이유: 목록 엔드포인트는 전량 스캔이 금지돼 있고(Never Do G2), ORDER BY가 없으면 페이지 간 행 중복·누락이 생긴다.
  // 방법: ADR 0021의 읽기 계층을 그대로 재사용 — 이스케이프한 ILIKE, SORT_COLUMN 매핑, id tiebreaker.
  async getPosts(query: GetPostsDto): Promise<[PostResponseDto[], number]> {
    const { take, skip, search, sortBy, order, creatorId } = query;

    const queryBuilder = this.baseQuery();

    const term = search?.trim();
    if (term) {
      queryBuilder.andWhere("post.title ILIKE :term ESCAPE '\\'", {
        term: `%${escapeLikePattern(term)}%`,
      });
    }

    // The creator join already exists, so the filter costs one predicate and no extra query.
    if (creatorId !== undefined) {
      queryBuilder.andWhere('creator.id = :creatorId', { creatorId });
    }

    queryBuilder.orderBy(SORT_COLUMN[sortBy], order);
    // A unique tiebreaker makes the page boundary deterministic when the sort column ties;
    // sorting by id already is one, so adding it twice would only duplicate the clause.
    if (sortBy !== 'id') {
      queryBuilder.addOrderBy('post.id', order);
    }

    const [posts, count] = await queryBuilder
      .take(take)
      .skip(skip)
      .getManyAndCount();
    return [posts.map((post) => this.toResponse(post)), count];
  }

  // 목적: 단일 게시글을 작성자·첨부 파일과 함께 조회한다.
  // 이유: 상세 화면은 본문뿐 아니라 작성자와 영상 URL을 함께 요구한다.
  // 방법: 관계를 미리 조인한 공통 빌더에 id 조건만 얹고, 없으면 404 POST_NOT_FOUND를 던진다.
  async getPostById(id: number): Promise<PostResponseDto> {
    const post = await this.baseQuery().where('post.id = :id', { id }).getOne();

    if (!post) {
      throw new NotFoundException({
        code: ErrorCode.POST_NOT_FOUND,
        message: 'No post found.',
      });
    }

    return this.toResponse(post);
  }

  // 목적: 주어진 id의 게시글이 실재하는지 판정한다.
  // 이유: 댓글은 없는 글에 달릴 수 없고, 그 판정은 post 상태를 소유한 PostModule의 몫이다 —
  //       CommentService가 post_entity를 직접 조회하면 모듈 경계를 넘는다(Tell Don't Ask).
  // 방법: 관계를 붙이지 않고 존재 여부만 확인해 없으면 404를 던진다 — 값은 반환하지 않는 판정 전용이다.
  //       getPostById 재사용은 창작자·파일 두 조인을 쓰지도 않을 응답을 위해 끌고 오게 된다.
  async assertPostExists(postId: number): Promise<void> {
    const exists = await this.postRepository.exists({ where: { id: postId } });

    if (!exists) {
      throw new NotFoundException({
        code: ErrorCode.POST_NOT_FOUND,
        message: 'No post found.',
      });
    }
  }

  // 목적: 특정 파일을 이미 점유한 게시글을 찾는다.
  // 이유: fileId의 유니크 제약이 이 엔드포인트의 유일한 자연 멱등 키이므로, 그 행의 존재가 "이미 첨부됨"의 증거다.
  // 방법: fileId 정확 일치로 조회하되 creator를 함께 로드해 재제출자 본인 여부를 판정할 수 있게 한다.
  private findByFileId(fileId: number): Promise<PostEntity | null> {
    return this.baseQuery().where('post.fileId = :fileId', { fileId }).getOne();
  }

  // 목적: 같은 파일로 들어온 재제출을 멱등 replay 또는 409로 판정한다.
  // 이유: 네트워크 재시도는 최초 성공과 같은 결과를 받아야 하지만, 본문이 다르면 그것은 재시도가 아니라 새 글이다.
  // 방법: 작성자 일치와 title/body 완전 일치를 모두 확인해 replay로 인정하고, 하나라도 어긋나면 POST_FILE_TAKEN.
  private resolveAttachment(
    existing: PostEntity,
    dto: CreatePostDto,
    userId: number,
  ): PostClaimResult {
    // Normally implied by the same-creator attach rule, but file ownership is
    // reassignable (PATCH /file/:id userId), so the new owner can legitimately reach a
    // post that is not theirs. Replay belongs to the original author only.
    const sameAuthor = existing.creator.id === userId;
    // Replay only on an identical payload — unlike ADR 0019's unconditional replay. A
    // file promotion carries no author-written text; a post does, so replaying a
    // different title/body would answer a genuinely new submission with an older post.
    if (
      !sameAuthor ||
      existing.title !== dto.title ||
      existing.body !== dto.body
    ) {
      throw new ConflictException({
        code: ErrorCode.POST_FILE_TAKEN,
        message: `This file is already attached to post ${existing.id}.`,
      });
    }

    return { replayed: true, post: this.toResponse(existing) };
  }

  // 목적: 잡힌 에러가 Postgres unique 위반인지 판별한다.
  // 이유: 동시 제출 경합으로 인한 제약 위반은 클라이언트 중복이지 서버 결함이므로 500과 분리해야 한다.
  // 방법: QueryFailedError로 좁힌 뒤 driverError.code를 캐스팅 없이 in 연산자로 확인해 '23505'와 비교한다.
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;

    const driverError: unknown = error.driverError;
    return (
      typeof driverError === 'object' &&
      driverError !== null &&
      'code' in driverError &&
      driverError.code === UNIQUE_VIOLATION
    );
  }

  // 목적: 게시글을 만들되, 같은 파일을 건 재제출은 멱등하게 판정한다.
  // 이유: 첨부 파일의 유니크 제약이 이 엔드포인트의 유일한 자연 멱등 키이고, 예견 가능한 클라이언트 중복이
  //       500으로 새어 나가서는 안 된다(Idempotence, ADR 0023 D1).
  // 방법: 첨부 허용 여부를 FileService에 먼저 묻고(404/403), 선점 행이 있으면 replay/409로 끝낸다. 그렇지 않을
  //       때만 단일 insert(트랜잭션 표 Row 1)를 실행하고, 경합으로 진 23505는 같은 판정 경로로 되돌린다.
  async create(dto: CreatePostDto, userId: number): Promise<PostClaimResult> {
    const { fileId } = dto;

    if (fileId !== undefined) {
      // The ownership decision lives in the layer that owns file state; this service
      // never reads file.creator itself (Law of Demeter / Tell Don't Ask).
      await this.fileService.assertAttachableBy(fileId, userId);

      const existing = await this.findByFileId(fileId);
      if (existing) {
        return this.resolveAttachment(existing, dto, userId);
      }
    }

    let insertedId: number;
    try {
      const inserted = await this.postRepository
        .createQueryBuilder()
        .insert()
        .into(PostEntity)
        .values({
          title: dto.title,
          body: dto.body,
          creator: { id: userId },
          // Omitted rather than set to null when absent — the column defaults to null,
          // and this keeps the values object free of a nullable-relation cast.
          ...(fileId !== undefined && { file: { id: fileId } }),
        })
        .execute();

      const identifier: unknown = inserted.identifiers[0]?.id;
      if (typeof identifier !== 'number') {
        throw new InternalServerErrorException({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Post could not be created.',
        });
      }
      insertedId = identifier;
    } catch (error) {
      // The lookup above is an unlocked read, so simultaneous submits can both pass it
      // and let the unique constraint pick the winner. Re-resolve through the same path
      // so the loser gets a replay or a typed 409, never a 500.
      if (fileId !== undefined && this.isUniqueViolation(error)) {
        const winner = await this.findByFileId(fileId);
        if (winner) {
          return this.resolveAttachment(winner, dto, userId);
        }
      }
      throw error;
    }

    // Re-read through the shared path: the insert result carries no relations, so
    // composing a response from it would omit the author email and the file URL.
    return { replayed: false, post: await this.getPostById(insertedId) };
  }

  // 목적: 게시글 본문을 수정한다.
  // 이유: 작성 후 오타·내용 정정은 게시판의 기본 요구이지만, 첨부 교체는 별도의 청구 표면을 열게 된다.
  // 방법: 작성자 또는 admin인지 확인한 뒤 title/body만 반영한다(단일 쓰기 — 트랜잭션 표 Row 1).
  async update(
    id: number,
    dto: UpdatePostDto,
    requester: Requester,
  ): Promise<PostResponseDto> {
    const post = await this.postRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!post) {
      throw new NotFoundException({
        code: ErrorCode.POST_NOT_FOUND,
        message: 'No post found.',
      });
    }

    if (!this.canManage(post.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the post author or an admin can update this post.',
      });
    }

    const updateFields: Partial<PostEntity> = {};
    if (dto.title !== undefined) updateFields.title = dto.title;
    if (dto.body !== undefined) updateFields.body = dto.body;

    // An empty PATCH is a no-op, not an error — TypeORM rejects an empty update set.
    if (Object.keys(updateFields).length > 0) {
      await this.postRepository.update({ id }, updateFields);
    }

    return this.getPostById(id);
  }

  // 목적: 게시글 한 건을 삭제하고 그 사실을 감사 로그에 남긴다.
  // 이유: 이 프로젝트의 삭제는 전부 하드 삭제라 되돌릴 수 없고(ADR 0020), 타인 자원에 대한 admin 권한은
  //       추적 가능해야 한다(ADR 0013).
  // 방법: 작성자 또는 admin인지 확인 → 행 삭제(단일 쓰기) → 커밋 뒤 감사 로그. 첨부 파일 행과 실제 파일은
  //       건드리지 않는다 — 게시글은 파일의 참조일 뿐 소유자가 아니다.
  async deletePost(id: number, requester: Requester): Promise<string> {
    const post = await this.postRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!post) {
      throw new NotFoundException({
        code: ErrorCode.POST_NOT_FOUND,
        message: 'No post found.',
      });
    }

    if (!this.canManage(post.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the post author or an admin can delete this post.',
      });
    }

    await this.postRepository.delete(id);

    await this.auditLogService.log(requester.id, id, 'POST_DELETE');

    return `Post ${id} deleted.`;
  }

  // 목적: 한 유저가 쓴 게시글 전부를 호출자의 트랜잭션 안에서 삭제하고 삭제 건수를 돌려준다.
  // 이유: 계정 삭제는 파일 행보다 먼저 게시글을 치워야 FK_post_entity_file/creator 위반이 남지 않고,
  //       게시글의 삭제 규칙은 UserModule이 아니라 PostModule의 책임이다(모듈 책임 경계, ADR 0023 D5).
  // 방법: id 목록이 아니라 creatorId 기준으로 지운다 — 조회 이후 끼어든 작성분까지 포함해야 경합이 없다.
  //       건수는 감사 로그 detail(posts=N)에 쓰인다.
  async deletePostsOfCreator(
    manager: EntityManager,
    creatorId: number,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(PostEntity)
      .where('"creatorId" = :creatorId', { creatorId })
      .execute();

    return result.affected ?? 0;
  }
}
