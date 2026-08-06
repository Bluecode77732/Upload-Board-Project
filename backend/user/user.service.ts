import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetUsersDto } from './dto/get-users.dto';
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
import { unlinkStoredFiles } from 'backend/common/unlink-stored-files';

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
  ) {}

  // 목적: 관리자용 전체 유저 목록을 개수와 함께 반환한다.
  // 이유: 기존 findAndCount()가 무제한으로 전체 테이블을 반환해 Never Do G2(목록 페이지네이션 필수)를
  //       위반하고 있었다 — ROADMAP 실행순서 #2로 확정된 독립 부채.
  // 방법: GetFilesDto와 동일한 take/skip 경계를 받고, createdAt DESC + id 타이브레이커로 고정 정렬해
  //       페이지 경계가 결정적이게 한다(검색/정렬 파라미터는 이번 범위에서 제외 — ADR 0021과 달리 클라이언트
  //       에 노출하지 않음).
  async findAll(query: GetUsersDto): Promise<[UserEntity[], number]> {
    const { take, skip } = query;
    return this.userRepository.findAndCount({
      take,
      skip,
      order: { createdAt: 'DESC', id: 'DESC' },
    });
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
  //       동급 admin이나 상위 superadmin 계정까지 수정할 수 있는 권한 역전 결함이 있었다.
  // 방법: 대상 엔티티를 먼저 읽어 role을 확보해 두고(이미 존재 확인용으로 읽던 조회를 재사용), 본인이 아니면
  //       target rank가 actor rank보다 낮을 때만 통과시킨다 — 동급/상위 대상은 본인이 아닌 한 항상 거부된다.
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

    if (actorId !== id && ROLE_RANK[user.role] >= ROLE_RANK[actorRole]) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Cannot modify an account with an equal or higher role.',
      });
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
  //       역전 결함도 있었다.
  // 방법: 트랜잭션 안에서 유저를 먼저 읽어 role을 확보하고, 본인이 아니면 target rank가 actor rank보다
  //       낮을 때만 통과시킨 뒤, 보유 파일 경로를 읽어 미확인이면 409로 거절하고, 확인 시 댓글 행 → 게시글
  //       행 → 파일 행 → 유저 행 순서로 지운다. 댓글과 게시글은 확인 플래그 없이 무조건 삭제된다(D5 — 플래그는
  //       파일 바이트만 지킨다). 물리 파일 unlink는 커밋 이후에만(롤백 불가), 감사 로그는 그 뒤에 남긴다.
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

        if (actorId !== id && ROLE_RANK[user.role] >= ROLE_RANK[actorRole]) {
          throw new ForbiddenException({
            code: ErrorCode.FORBIDDEN,
            message: 'Cannot delete an account with an equal or higher role.',
          });
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
    const { failures } = await unlinkStoredFiles(storedPaths);
    for (const failure of failures) {
      this.logger.warn(
        `Stored file left on disk: ${failure.filePath} (${failure.reason})`,
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
