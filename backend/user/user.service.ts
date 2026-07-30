import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { FileService } from 'backend/file/file.service';
import { PostService } from 'backend/post/post.service';
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
  ) {}

  async findAll() {
    return this.userRepository.findAndCount();
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

  async update(id: number, updateUserDto: UpdateUserDto) {
    const { password } = updateUserDto;

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
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
  //       연쇄 삭제는 되돌릴 수 없으므로 동의 없이 일어나서는 안 된다(ADR 0020). 게시글이 추가되면서
  //       post_entity가 유저와 파일을 모두 참조하게 되어, 삭제 순서에 게시글이 먼저 들어와야 한다(ADR 0023 D5).
  // 방법: 트랜잭션 안에서 보유 파일 경로를 먼저 읽어 미확인이면 409로 거절하고, 확인 시 게시글 행 → 파일 행
  //       → 유저 행 순서로 지운다. 게시글은 확인 플래그 없이 무조건 삭제된다(D5 — 플래그는 파일 바이트만 지킨다).
  //       물리 파일 unlink는 커밋 이후에만(롤백 불가), 감사 로그는 그 뒤에 남긴다.
  async remove(actorId: number, id: number, deleteFiles = false) {
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

        // Posts first: FK_post_entity_file references the file rows about to go, and
        // FK_post_entity_creator references the user row — both are ON DELETE NO ACTION.
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
