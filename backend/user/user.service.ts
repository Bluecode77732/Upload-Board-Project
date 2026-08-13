import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetUsersDto, UserSortField } from './dto/get-users.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { FileService } from 'backend/file/file.service';
import { PostService } from 'backend/post/post.service';
import { CommentService } from 'backend/comment/comment.service';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';

// The sole bridge from a client sort key to a column (ADR 0021 pattern). Typed as a total
// Record over UserSortField, so a key added to USER_SORT_FIELDS without a column here fails
// to compile — the whitelist cannot silently drift out of sync with the query.
const SORT_COLUMN: Record<UserSortField, string> = {
  createdAt: 'user.createdAt',
  email: 'user.email',
  id: 'user.id',
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly auditLogService: AuditLogService,
    private readonly fileService: FileService,
    private readonly postService: PostService,
    private readonly commentService: CommentService,

    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage,
  ) {}

  // 목적: 관리자용 유저 목록을 이메일 검색·화이트리스트 정렬과 함께 개수째 반환한다.
  // 이유: 기존 findAndCount()가 검색·정렬 없이 무제한 전체 테이블을 반환해 Never Do G2(목록 페이지네이션
  //       필수)를 위반하고 있었다(ROADMAP 실행순서 #2). admin 콘솔의 유저 검색은 이 백엔드가 지원하지
  //       않아 제거됐던 기능인데(admin/README.md "What was adapted"), GET /file은 이미 ADR 0021로 이
  //       패턴(search/sortBy/order)을 갖고 있어 GET /user만 뒤처져 있었다.
  // 방법: GetFilesDto와 동일한 QueryBuilder 조립 — 검색어는 와일드카드를 이스케이프한 ILIKE로 email에
  //       적용하고, 정렬 컬럼은 SORT_COLUMN 매핑으로만 결정해(문자열이 직접 컬럼명으로 보간되지 않음)
  //       id를 tiebreaker로 덧붙여 페이징을 안정화한다(정렬 없는 OFFSET은 순서가 미정의).
  async findAll(query: GetUsersDto): Promise<[UserEntity[], number]> {
    const { take, skip, search, sortBy, order } = query;

    const queryBuilder = this.userRepository.createQueryBuilder('user');

    const term = search?.trim();
    if (term) {
      queryBuilder.andWhere("user.email ILIKE :term ESCAPE '\\'", {
        term: `%${escapeLikePattern(term)}%`,
      });
    }

    queryBuilder.orderBy(SORT_COLUMN[sortBy], order);
    // A unique tiebreaker makes the page boundary deterministic when the sort column ties;
    // sorting by id already is one, so adding it twice would only duplicate the clause.
    if (sortBy !== 'id') {
      queryBuilder.addOrderBy('user.id', order);
    }

    return queryBuilder.take(take).skip(skip).getManyAndCount();
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
      });
    }

    return user;
  }

  // 목적: 계정 정보(email/password)를 갱신하되, 본인이거나 대상보다 role이 낮은 admin 이상만 허용한다.
  // 이유: 기존에는 actor.role이 admin 이상인지만 컨트롤러에서 확인하고 대상의 role은 보지 않아, admin이
  //       동급 admin이나 상위 superadmin 계정까지 수정할 수 있는 권한 역전 결함이 있었다. 그 결함을 고치며
  //       컨트롤러가 갖고 있던 "본인이 아니고 admin도 아니면 거부" 검사를 서비스로 옮기지 않아, plain user가
  //       다른 plain user를 수정하려 할 때도 랭크 비교 분기로 흘러 FORBIDDEN_NOT_OWNER 대신 FORBIDDEN이
  //       나가는 회귀가 있었다.
  // 방법: 대상 엔티티를 먼저 읽어 role을 확보해 두고(이미 존재 확인용으로 읽던 조회를 재사용), 본인이 아니면
  //       ① actor가 admin 미만이면 소유자가 아니라는 이유로 즉시 거부(FORBIDDEN_NOT_OWNER), ② admin
  //       이상이면 target rank가 actor rank보다 낮을 때만 통과시킨다 — 동급/상위 대상은 거부(FORBIDDEN).
  async update(
    actorId: number,
    actorRole: UserRole,
    id: number,
    updateUserDto: UpdateUserDto,
  ) {
    const { password } = updateUserDto;

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
      });
    }

    if (actorId !== id) {
      if (ROLE_RANK[actorRole] < ROLE_RANK[UserRole.admin]) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN_NOT_OWNER,
          message: 'You can only update your own account.',
        });
      }

      if (ROLE_RANK[user.role] >= ROLE_RANK[actorRole]) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN,
          message: 'Cannot modify an account with an equal or higher role.',
        });
      }
    }

    if (password) {
      updateUserDto.password = await bcrypt.hash(
        password,
        this.configService.getOrThrow<number>('HASH_ROUNDS'),
      );
    }

    await this.userRepository.update(
      { id },
      {
        email: updateUserDto.email,
        password: updateUserDto.password,
      },
    );

    return this.userRepository.findOne({ where: { id } });
  }

  // Pure multi-DB-write with a read-modify-write invariant (last-superadmin guard) →
  // dataSource.transaction (Transaction Boundary table); SERIALIZABLE + a row lock
  // stop two concurrent demotions from both passing the count check.
  async updateRole(actorId: number, targetId: number, role: UserRole) {
    const previousRole = await this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const target = await manager.findOne(UserEntity, {
          where: { id: targetId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!target) {
          throw new NotFoundException({
            code: ErrorCode.USER_NOT_FOUND,
            message: 'User not found.',
          });
        }

        const previous = target.role;

        // superadmins are demotable (model ①), but never the last one — that would
        // lock the role system (nobody left to promote anyone).
        if (previous === UserRole.superadmin && role !== UserRole.superadmin) {
          const superadminCount = await manager.count(UserEntity, {
            where: { role: UserRole.superadmin },
          });
          if (superadminCount <= 1) {
            throw new BadRequestException({
              code: ErrorCode.AUTH_LAST_SUPERADMIN,
              message: 'Cannot demote the last superadmin.',
            });
          }
        }

        // Any role change ends the target's refresh session (refreshTokenHash: null)
        // so a demotion is fully in effect immediately, not just on the next access.
        await manager.update(UserEntity, targetId, {
          role,
          refreshTokenHash: null,
        });

        return previous;
      },
    );

    // Audit after commit (side effect isolated — a log failure must not roll back the role change).
    await this.auditLogService.log(
      actorId,
      targetId,
      'ROLE_CHANGE',
      `${previousRole}→${role}`,
    );

    return { id: targetId, role };
  }

  // 목적: 계정을 삭제하되, 그 계정이 소유한 파일까지 함께 지울지를 명시적 확인에 따라 결정한다.
  // 이유: FileEntity.creator가 nullable:false라 파일 보유 계정의 단순 삭제는 FK 위반 500이었고,
  //       연쇄 삭제는 되돌릴 수 없으므로 동의 없이 일어나서는 안 된다(ADR 0020). 게시글·댓글이 추가되면서
  //       두 테이블이 유저를 참조하게 되어, 삭제 순서에 댓글 → 게시글이 먼저 들어와야 한다(ADR 0023 D5).
  //       기존에는 대상의 role을 보지 않아 admin이 동급/상위(superadmin) 계정까지 삭제할 수 있는 권한
  //       역전 결함도 있었다. 그 결함을 고치며 컨트롤러의 "본인이 아니고 admin도 아니면 거부" 검사를
  //       서비스로 옮기지 않아, plain user가 다른 plain user를 삭제하려 할 때도 FORBIDDEN_NOT_OWNER
  //       대신 FORBIDDEN이 나가는 회귀가 있었다.
  // 방법: 트랜잭션 안에서 유저를 먼저 읽어 role을 확보하고, 본인이 아니면 ① actor가 admin 미만이면
  //       소유자가 아니라는 이유로 즉시 거부(FORBIDDEN_NOT_OWNER), ② admin 이상이면 target rank가
  //       actor rank보다 낮을 때만 통과시킨다(동급/상위는 FORBIDDEN). 통과 후 보유 파일 경로를 읽어
  //       미확인이면 409로 거절하고, 확인 시 댓글 행 → 게시글 행 → 파일 행 → 유저 행 순서로 지운다.
  //       댓글과 게시글은 확인 플래그 없이 무조건 삭제된다(D5 — 플래그는 파일 바이트만 지킨다). 물리 파일
  //       unlink는 커밋 이후에만(롤백 불가), 감사 로그는 그 뒤에 남긴다.
  async remove(
    actorId: number,
    actorRole: UserRole,
    id: number,
    deleteFiles = false,
  ) {
    // Pure multi-DB-write — the filesystem side effect deliberately sits outside the
    // boundary, so dataSource.transaction applies (Transaction Boundary table, row 3).
    const { storedPaths, deletedPosts } = await this.dataSource.transaction(
      async (manager) => {
        const user = await manager.findOne(UserEntity, { where: { id } });

        if (!user) {
          throw new NotFoundException({
            code: ErrorCode.USER_NOT_FOUND,
            message: 'User not found.',
          });
        }

        if (actorId !== id) {
          if (ROLE_RANK[actorRole] < ROLE_RANK[UserRole.admin]) {
            throw new ForbiddenException({
              code: ErrorCode.FORBIDDEN_NOT_OWNER,
              message: 'You can only delete your own account.',
            });
          }

          if (ROLE_RANK[user.role] >= ROLE_RANK[actorRole]) {
            throw new ForbiddenException({
              code: ErrorCode.FORBIDDEN,
              message: 'Cannot delete an account with an equal or higher role.',
            });
          }
        }

        const paths = await this.fileService.findStoredPathsOfCreator(
          manager,
          id,
        );

        // The cascade is irreversible, so it needs an explicit confirmation; the count
        // lets the client warn with the real number before asking for one. The flag
        // deliberately still guards files only — it names the media bytes it protects.
        if (paths.length > 0 && !deleteFiles) {
          throw new ConflictException({
            code: ErrorCode.USER_HAS_FILES,
            message: `This account owns ${paths.length} file(s). Repeat with deleteFiles=true to delete them together.`,
          });
        }

        // Comments the account wrote anywhere go first: the ones on *other people's*
        // posts are reachable no other way, since the FK cascade only fires when the
        // owning post is deleted (ADR 0023 D5).
        await this.commentService.deleteCommentsOfCreator(manager, id);

        // Posts next: FK_post_entity_file references the file rows about to go, and
        // FK_post_entity_creator references the user row — both are ON DELETE NO ACTION.
        // Whatever comments remain on these posts go with them via ON DELETE CASCADE.
        const posts = await this.postService.deletePostsOfCreator(manager, id);

        // Files next — FK_file_entity_creator is ON DELETE NO ACTION, so the user row
        // cannot go while any file still references it.
        if (paths.length > 0) {
          await this.fileService.deleteFilesOfCreator(manager, id);
        }
        await manager.delete(UserEntity, id);

        return { storedPaths: paths, deletedPosts: posts };
      },
    );

    // Post-commit on purpose: unlink cannot be rolled back, so its failure leaves a
    // recoverable orphan on disk rather than a row pointing at a missing file.
    const { failures } = await this.storage.unlink(storedPaths);
    for (const failure of failures) {
      this.logger.warn(
        `Stored file left on disk: ${failure.key} (${failure.reason})`,
      );
    }

    await this.auditLogService.log(
      actorId,
      id,
      'USER_DELETE',
      `files=${storedPaths.length} posts=${deletedPosts}`,
    );

    return `User ${id} deleted.`;
  }
}
