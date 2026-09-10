// 목적: 게시판 게시글의 비즈니스 로직 — CRUD, 첨부 claim 판정, 소유권 검사, 계정 cascade 삭제를 담당한다.
// 사용처: PostController가 주입해 쓰며, deletePostsOfCreator는 UserService가 자신의 삭제 트랜잭션 안에서 호출한다.
// 근거: ADR 0023이 게시글을 자기 도메인 모듈로 둔다 — FileModule에 접으면 게시판 내용과 파일 메타데이터가 섞여, 모듈 분리 정책이 지키려는 경계가 무너진다.

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
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { ErrorCode } from 'backend/common/error-code';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';

// 요청을 수행하는 유저의 신원 + 역할(JWT에서 온다) — creator-OR-admin 검사에 충분하다.
interface Requester {
  id: number;
  role: UserRole;
}

// 생성 시도의 결과: `replayed`는 이전의 자기 성공을 발견한 재시도를 표시해,
// 컨트롤러가 두 번째 201 대신 200으로 응답할 수 있게 한다 (ADR 0023 D1).
export interface PostClaimResult {
  replayed: boolean;
  post: PostResponseDto;
}

// UQ_post_entity_fileId에서 발생한 Postgres unique_violation — 동시 이중 제출이
// 경합에서 진 것이며, 서버 결함이 아니라 클라이언트 중복이다.
const UNIQUE_VIOLATION = '23505';

// 클라이언트 정렬 키를 컬럼으로 잇는 유일한 다리다 (ADR 0021). PostSortField에 대한
// total Record로 타입을 잡아서, POST_SORT_FIELDS에 컬럼 매핑 없이 키를 추가하면
// 컴파일이 실패한다 — 화이트리스트가 쿼리와 조용히 어긋날 수 없다.
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

  // 게시글은 작성자 본인이거나 admin/superadmin이면 관리할 수 있다 (RBAC, ADR 0013).
  // FileService.canManage와 의도적으로 같은 모양이다 — 게시판은 새로운 권한 축을 도입하지
  // 않으며, 특히 "게시글 작성자가 자기 댓글을 모더레이션한다"는 규칙도 아니다.
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

    // creator join은 이미 존재하므로, 이 필터는 predicate 하나만 더할 뿐 추가 쿼리가 없다.
    if (creatorId !== undefined) {
      queryBuilder.andWhere('creator.id = :creatorId', { creatorId });
    }

    queryBuilder.orderBy(SORT_COLUMN[sortBy], order);
    // 고유한 tiebreaker는 정렬 컬럼 값이 같을 때 페이지 경계를 결정적으로 만든다;
    // id로 정렬하는 경우는 이미 그 자체가 tiebreaker이므로, 다시 추가하면 절만 중복될 뿐이다.
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
    // 평소에는 same-creator 첨부 규칙이 이를 함축하지만, 파일 소유권은 재할당될 수 있어서
    // (PATCH /file/:id userId) 새 소유자가 자기 것이 아닌 게시글에 정당하게 닿을 수 있다.
    // replay는 오직 원 작성자에게만 해당한다.
    const sameAuthor = existing.creator.id === userId;
    // 페이로드가 완전히 같을 때만 replay — ADR 0019의 무조건적 replay와 다르다. 파일
    // promotion에는 작성자가 쓴 텍스트가 없지만 게시글에는 있으므로, title/body가 다른데도
    // replay로 처리하면 실제로는 새로운 제출을 예전 게시글로 응답하는 셈이 된다.
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
      // 소유권 판단은 파일 상태를 소유한 계층의 몫이다; 이 서비스는 file.creator를
      // 스스로 읽지 않는다 (Law of Demeter / Tell Don't Ask).
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
          // 값이 없을 때 null로 설정하지 않고 아예 생략한다 — 컬럼 기본값이 이미 null이고,
          // 이렇게 하면 values 객체에 nullable-relation 캐스팅이 끼어들지 않는다.
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
      // 위의 조회는 락 없는 읽기라서, 동시 제출이 둘 다 통과한 뒤 unique 제약이
      // 승자를 가릴 수 있다. 진 쪽이 500이 아니라 replay나 타입 있는 409를 받도록
      // 같은 경로로 다시 판정한다.
      if (fileId !== undefined && this.isUniqueViolation(error)) {
        const winner = await this.findByFileId(fileId);
        if (winner) {
          return this.resolveAttachment(winner, dto, userId);
        }
      }
      throw error;
    }

    // 공유 경로로 다시 읽는다: insert 결과에는 관계가 없어서, 그걸로 바로 응답을
    // 조립하면 작성자 이메일과 파일 URL이 빠진다.
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

    // 빈 PATCH는 에러가 아니라 no-op이다 — TypeORM은 빈 업데이트 집합을 거부한다.
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

    await this.auditLogService.log(
      requester.id,
      id,
      AuditTargetType.post,
      'POST_DELETE',
    );

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
