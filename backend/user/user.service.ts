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
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { FileService } from 'backend/file/file.service';
import { PostService } from 'backend/post/post.service';
import { CommentService } from 'backend/comment/comment.service';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';

// 클라이언트 정렬 키를 컬럼으로 잇는 유일한 다리다 (ADR 0021 패턴). UserSortField에 대한
// total Record로 타입을 잡아서, USER_SORT_FIELDS에 컬럼 매핑 없이 키를 추가하면
// 컴파일이 실패한다 — 화이트리스트가 쿼리와 조용히 어긋날 수 없다.
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
    // 고유한 tiebreaker는 정렬 컬럼 값이 같을 때 페이지 경계를 결정적으로 만든다;
    // id로 정렬하는 경우는 이미 그 자체가 tiebreaker이므로, 다시 추가하면 절만 중복될 뿐이다.
    if (sortBy !== 'id') {
      queryBuilder.addOrderBy('user.id', order);
    }

    return queryBuilder.take(take).skip(skip).getManyAndCount();
  }

  // 목적: id로 유저 한 명을 조회하고 없으면 표준화된 404를 던진다.
  // 이유: JwtStrategy.validate를 포함해 여러 호출부가 "존재하지 않으면 즉시 실패"를 기대하므로,
  //       null 반환 대신 예외로 강제해 각 호출부가 매번 null 체크를 반복하지 않게 한다.
  // 방법: 단순 조회 후 없으면 USER_NOT_FOUND 404, 있으면 엔티티를 그대로 반환한다.
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

  // 목적: 이메일로 유저 한 명을 정확히 일치 조회하고 없으면 표준화된 404를 던진다.
  // 이유: 파일 이전 제안(ADR 0050)이 숫자 userId만 받는데, 일반 유저는 상대방 id를 알 방법이
  //       없다 — GET /user(목록)는 admin 전용이라 이메일→id 단건 조회가 별도로 필요하다.
  // 방법: findOne과 같은 존재-확인 패턴이되, email 컬럼의 정확 일치로 조회한다(부분 일치 ILIKE가
  //       아님 — 여러 후보가 나오면 어느 걸 골라야 할지 모호해진다).
  async findByEmail(email: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({ where: { email } });

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

  // 목적: superadmin이 대상 계정의 role을 바꾸고 그 변경을 감사 로그에 남긴다.
  // 이유: role 강등이 "마지막 superadmin을 강등"하는 경우 시스템에 아무도 승격시킬 사람이
  //       남지 않는 잠금 상태가 된다 — 동시에 두 개의 강등 요청이 들어와도 이 불변식이 깨지지
  //       않아야 한다(ADR 0013).
  // 방법: 순수 다중 DB 쓰기 + read-modify-write 불변식(마지막 superadmin 가드)이므로
  //       dataSource.transaction 사용(Transaction Boundary 표) — SERIALIZABLE 격리와 대상 행
  //       row lock으로 두 동시 강등 요청이 둘 다 count 체크를 통과하는 것을 막는다. role 변경은
  //       즉시 refreshTokenHash를 지워 세션을 끊고, 감사 로그는 커밋 이후에 남긴다(부수효과 분리).
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

        // superadmin은 강등될 수 있지만(모델 ①), 마지막 한 명은 절대 안 된다 — 그러면
        // 누구도 승격시킬 사람이 없이 role 체계가 잠긴다.
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

        // role이 바뀌면 무조건 대상의 refresh 세션을 끊는다(refreshTokenHash: null) —
        // 강등이 다음 접근이 아니라 즉시 완전히 적용되도록 하기 위해서다.
        await manager.update(UserEntity, targetId, {
          role,
          refreshTokenHash: null,
        });

        return previous;
      },
    );

    // 커밋 이후에 감사 로그를 남긴다 (부수효과를 분리 — 로그 실패가 role 변경을 롤백해서는 안 된다).
    await this.auditLogService.log(
      actorId,
      targetId,
      AuditTargetType.user,
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
    // 순수 다중 DB 쓰기다 — 파일시스템 부수효과는 의도적으로 트랜잭션 경계 밖에 두므로,
    // dataSource.transaction이 적용된다 (Transaction Boundary 표, 세 번째 행).
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

        // 이 cascade는 되돌릴 수 없어서 명시적 확인이 필요하다; 개수를 함께 돌려주면
        // 클라이언트가 확인을 요구하기 전에 실제 숫자로 경고할 수 있다. 이 플래그는
        // 의도적으로 파일만 지킨다 — 자신이 보호하는 게 미디어 바이트라는 걸 이름으로 드러낸다.
        if (paths.length > 0 && !deleteFiles) {
          throw new ConflictException({
            code: ErrorCode.USER_HAS_FILES,
            message: `This account owns ${paths.length} file(s). Repeat with deleteFiles=true to delete them together.`,
          });
        }

        // 이 계정이 어디에 썼든 댓글부터 먼저 지운다: *다른 사람의* 게시글에 단 댓글은
        // 그 게시글이 삭제될 때만 FK cascade가 발동하므로, 다른 방법으로는 닿을 수 없다
        // (ADR 0023 D5).
        await this.commentService.deleteCommentsOfCreator(manager, id);

        // 다음은 게시글이다: FK_post_entity_file은 곧 지워질 파일 행을 참조하고,
        // FK_post_entity_creator는 유저 행을 참조하는데 — 둘 다 ON DELETE NO ACTION이다.
        // 이 게시글들에 남아 있는 댓글은 ON DELETE CASCADE로 함께 지워진다.
        const posts = await this.postService.deletePostsOfCreator(manager, id);

        // 다음은 파일이다 — FK_file_entity_creator가 ON DELETE NO ACTION이라, 파일이
        // 하나라도 참조하는 동안은 유저 행이 지워질 수 없다.
        if (paths.length > 0) {
          await this.fileService.deleteFilesOfCreator(manager, id);
        }
        await manager.delete(UserEntity, id);

        return { storedPaths: paths, deletedPosts: posts };
      },
    );

    // 의도적으로 커밋 이후에 실행한다: unlink는 롤백할 수 없으므로, 실패해도 존재하지 않는
    // 파일을 가리키는 행이 아니라 디스크에 남은 복구 가능한 고아 파일이 되게 한다.
    const { failures } = await this.storage.unlink(storedPaths);
    for (const failure of failures) {
      this.logger.warn(
        `Stored file left on disk: ${failure.key} (${failure.reason})`,
      );
    }

    await this.auditLogService.log(
      actorId,
      id,
      AuditTargetType.user,
      'USER_DELETE',
      `files=${storedPaths.length} posts=${deletedPosts}`,
    );

    return `User ${id} deleted.`;
  }
}
