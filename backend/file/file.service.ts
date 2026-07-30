import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { UserEntity } from 'backend/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { access, rename } from 'fs/promises';
import path, { join } from 'path';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { FileSortField, GetFilesDto } from './dto/get-files.dto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { unlinkStoredFiles } from 'backend/common/unlink-stored-files';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';

// The acting user's identity + role (from the JWT), enough for creator-OR-admin checks.
interface Requester {
  id: number;
  role: UserRole;
}

// Outcome of a claim attempt: `replayed` marks a retry that found its own earlier
// success, so the controller can answer 200 instead of a second 201 (ADR 0019).
export interface FileClaimResult {
  replayed: boolean;
  file: FileResponseDto;
}

// Postgres unique_violation. A concurrent double-submit loses this race by design;
// it is a client-side duplicate, not a server fault, so it must not surface as 500.
const UNIQUE_VIOLATION = '23505';

// Postgres foreign_key_violation. Raised when a post still references the file row
// being deleted — a legitimate client outcome (409), not a server fault (ADR 0023 D4).
const FOREIGN_KEY_VIOLATION = '23503';

// The sole bridge from a client sort key to a column (ADR 0021). Typed as a total Record
// over FileSortField, so a key added to FILE_SORT_FIELDS without a column here fails to
// compile — the whitelist cannot silently drift out of sync with the query.
const SORT_COLUMN: Record<FileSortField, string> = {
  createdAt: 'file.createdAt',
  title: 'file.title',
  id: 'file.id',
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly auditLogService: AuditLogService,
  ) {}

  // A file is manageable by its creator, or by an admin/superadmin (RBAC, ADR 0013).
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  // 목적: FileEntity를 공개 URL이 붙은 응답 DTO로 변환한다.
  // 이유: BASE_URL 합성은 한 곳에만 있어야 하는데, 게시글 응답도 첨부 파일 URL을 담아야 한다(ADR 0023).
  // 방법: private에서 public으로만 올린다 — PostService가 자기 쪽에서 URL을 다시 조립하지 않고 이 메서드에 위임한다.
  toResponse(file: FileEntity): FileResponseDto {
    const baseUrl = this.configService.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
    return {
      id: file.id,
      title: file.title,
      fileUrl: `${baseUrl}/${file.filePath}`,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      ...(file.creator && {
        creator: {
          id: file.creator.id,
          email: file.creator.email,
        },
      }),
    };
  }

  // 목적: 목록 조회에 제목 검색·작성자 필터·화이트리스트 정렬을 기존 페이지네이션 위에 얹는다.
  // 이유: take/skip만으로는 최신순 조회도 검색도 불가능했고, ORDER BY가 아예 없어 페이지 간 행
  //       중복·누락까지 가능했다(정렬 없는 OFFSET은 순서가 미정의).
  // 방법: 기존 QueryBuilder에 조건만 조립 — 검색어는 와일드카드를 이스케이프한 ILIKE, 정렬 컬럼은
  //       SORT_COLUMN 매핑으로만 결정하고, id를 tiebreaker로 덧붙여 페이징을 안정화한다.
  async getFiles(query: GetFilesDto): Promise<[FileResponseDto[], number]> {
    const { take, skip, search, sortBy, order, creatorId } = query;

    const queryBuilder = this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator');

    const term = search?.trim();
    if (term) {
      queryBuilder.andWhere("file.title ILIKE :term ESCAPE '\\'", {
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
      queryBuilder.addOrderBy('file.id', order);
    }

    const [files, count] = await queryBuilder
      .take(take)
      .skip(skip)
      .getManyAndCount();
    return [files.map((f) => this.toResponse(f)), count];
  }

  async getFileById(id: number): Promise<FileResponseDto> {
    const file = await this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    return this.toResponse(file);
  }

  // 목적: attach가 발급한 temp 파일명을 승격 후 저장 경로(file/upload/granted_...)로 변환한다.
  // 이유: 청구 여부 판정과 실제 insert가 서로 다른 경로 문자열을 쓰면 재시도 판정이 어긋난다.
  // 방법: temp_ → granted_ 치환 후 upload 폴더에 결합하고, DB 저장 형식대로 구분자를 '/'로 통일한다.
  private toStoredPath(tempFilename: string): string {
    return path
      .normalize(join('file', 'upload', tempFilename))
      .replace('temp_', 'granted_')
      .replace(/\\/g, '/');
  }

  // 목적: 해당 저장 경로를 이미 점유한 FileEntity 행을 찾는다.
  // 이유: 서버 발급 파일명은 1회용 청구 토큰이므로, 그 행의 존재 자체가 "이미 청구됨"의 증거다.
  // 방법: filePath 정확 일치로 조회하되 creator를 함께 로드해 재제출자 본인 여부를 판정할 수 있게 한다.
  private findClaim(storedPath: string): Promise<FileEntity | null> {
    return this.fileRepository.findOne({
      where: { filePath: storedPath },
      relations: ['creator'],
    });
  }

  // 목적: 이미 청구된 업로드의 재제출을 멱등 replay 또는 409로 판정한다.
  // 이유: 네트워크 재시도는 최초 성공과 같은 결과를 받아야 하고, 타인의 청구는 가로챌 수 없어야 한다.
  // 방법: 행의 creator와 요청자 id를 비교 — 일치하면 기존 리소스를 replayed로 반환, 아니면 FILE_ALREADY_CLAIMED.
  private resolveClaim(claim: FileEntity, userId: number): FileClaimResult {
    // Deliberately identity-only: replay belongs to the original submitter, so an
    // admin re-posting someone else's filename is a conflict, not a retry.
    if (claim.creator.id !== userId) {
      throw new ConflictException({
        code: ErrorCode.FILE_ALREADY_CLAIMED,
        message: 'This upload was already claimed.',
      });
    }

    return { replayed: true, file: this.toResponse(claim) };
  }

  // 목적: 잡힌 에러가 지정한 Postgres SQLSTATE 코드인지 판별한다.
  // 이유: 제약 위반(중복 23505, 참조 중 23503)은 클라이언트 측 사유이지 서버 결함이 아니므로 500과 분리해야 하고,
  //       판별 대상이 둘로 늘면서 코드별로 같은 좁히기 로직을 복제할 이유가 없어졌다.
  // 방법: QueryFailedError로 좁힌 뒤 driverError.code를 캐스팅 없이 in 연산자로 확인해 인자로 받은 코드와 비교한다.
  private isPgErrorCode(error: unknown, code: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;

    const driverError: unknown = error.driverError;
    return (
      typeof driverError === 'object' &&
      driverError !== null &&
      'code' in driverError &&
      driverError.code === code
    );
  }

  // 목적: 특정 파일을 요청자가 게시글에 첨부해도 되는지 판정한다.
  // 이유: 첨부 가능 여부는 파일 소유권 판정이므로 그 상태를 소유한 FileModule이 답해야 하고,
  //       PostService가 file.creator.id를 직접 들여다보는 것은 디미터 법칙 위반이다.
  // 방법: creator를 함께 로드해 없으면 404, 생성자 본인이 아니면 403을 던진다 — 값 반환 없이 판정만 한다.
  async assertAttachableBy(fileId: number, requesterId: number): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId },
      relations: ['creator'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    // Deliberately identity-only, not canManage: "a post references only its own
    // author's file" is what makes the account cascade FK-safe (ADR 0023 D1), and an
    // admin attaching someone else's file would break that invariant, not enforce it.
    if (file.creator.id !== requesterId) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'You can only attach a file you created.',
      });
    }
  }

  // 목적: temp 업로드를 소유 파일로 승격하고, 같은 요청의 재제출을 멱등하게 처리한다.
  // 이유: DB 저장과 물리 rename이 따로 실패하면 행이 없는 파일을 가리키고, 재시도는 모호한 400이나 500을 받는다.
  // 방법: 서버 발급 파일명을 1회용 청구 토큰으로 삼아 선청구 여부를 먼저 판정(replay/409)하고, 미청구일 때만
  //       QueryRunner 트랜잭션 하나로 insert → rename → commit; 실패 시 rollback, release()는 finally.
  async uploadFile(
    uploadFileDto: UploadFileDto,
    userId: number,
  ): Promise<FileClaimResult> {
    const temporaryFolder = join('file', 'temp');
    const uploadFolder = join('file', 'upload');
    const storedPath = this.toStoredPath(uploadFileDto.filePath);

    // A retry of an already-succeeded request must not open a transaction at all.
    const existingClaim = await this.findClaim(storedPath);
    if (existingClaim) {
      return this.resolveClaim(existingClaim, userId);
    }

    // Nothing claims the filename and no temp file backs it: never issued, or swept
    // past its TTL (ADR 0018). That is a client precondition failure, not a 500.
    try {
      await access(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
      );
    } catch {
      throw new BadRequestException({
        code: ErrorCode.FILE_INVALID_PATH,
        message: 'Attach the file again.',
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let fileId: number;
    try {
      // Title is unique — pre-check so the DB constraint surfaces as a typed
      // FILE_TITLE_TAKEN instead of being swallowed into a generic 500 (mirrors updateFile).
      const duplicatedTitle = await this.fileRepository.findOne({
        where: { title: uploadFileDto.title },
      });
      if (duplicatedTitle) {
        throw new BadRequestException({
          code: ErrorCode.FILE_TITLE_TAKEN,
          message: 'Title already in use.',
        });
      }

      const upload = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(FileEntity)
        .values({
          title: uploadFileDto.title,
          creator: { id: userId },
          filePath: storedPath,
        })
        .execute();

      const insertedId: unknown = upload.identifiers[0]?.id;
      if (typeof insertedId !== 'number') {
        throw new InternalServerErrorException({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Transaction aborted.',
        });
      }
      fileId = insertedId;
      const newFilePath = uploadFileDto.filePath.replace('temp_', 'granted_');

      await rename(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
        join(process.cwd(), uploadFolder, newFilePath),
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // Preserve typed domain exceptions (e.g. FILE_TITLE_TAKEN); only opaque
      // failures collapse to a generic message so no internal detail leaks out.
      if (error instanceof HttpException) throw error;

      // The title pre-check is an unlocked read, so simultaneous submits can both pass
      // it and let the unique constraint pick the winner. If the winner claimed this same
      // filename, the loser is the same request twice — replay it instead of erroring.
      if (this.isPgErrorCode(error, UNIQUE_VIOLATION)) {
        const winner = await this.findClaim(storedPath);
        if (winner) {
          return this.resolveClaim(winner, userId);
        }
        throw new BadRequestException({
          code: ErrorCode.FILE_TITLE_TAKEN,
          message: 'Title already in use.',
        });
      }

      throw new InternalServerErrorException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Transaction aborted.',
      });
    } finally {
      await queryRunner.release();
    }

    // Post-commit re-read stays outside the try: a read failure here must not
    // attempt a rollback of the already-committed transaction.
    const saved = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!saved) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return { replayed: false, file: this.toResponse(saved) };
  }

  async updateFile(
    id: number,
    updateFileDto: UpdateFileDto,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const file = await queryRunner.manager.findOne(FileEntity, {
        where: { id },
        relations: ['creator'],
      });

      if (!file) {
        throw new NotFoundException({
          code: ErrorCode.FILE_NOT_FOUND,
          message: 'No file found.',
        });
      }

      // Creator or admin may modify (including reassigning ownership via UpdateFileDto.userId).
      if (!this.canManage(file.creator.id, requester)) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN_NOT_OWNER,
          message: 'Only the file creator or an admin can update this file.',
        });
      }

      const { title, userId, filePath } = updateFileDto;
      const updateFields: Partial<FileEntity> = {};

      if (title) {
        const duplicatedTitle = await this.fileRepository.findOne({
          where: { title },
        });
        if (duplicatedTitle) {
          throw new BadRequestException({
            code: ErrorCode.FILE_TITLE_TAKEN,
            message: 'Title already in use.',
          });
        }
        updateFields.title = title;
      }

      if (filePath) {
        if (filePath.startsWith('temp_')) {
          throw new BadRequestException({
            code: ErrorCode.FILE_INVALID_PATH,
            message: 'File must be in the upload folder.',
          });
        }
        if (filePath.startsWith('granted_')) {
          updateFields.filePath = filePath;
        } else {
          throw new BadRequestException({
            code: ErrorCode.FILE_INVALID_PATH,
            message: 'Attach the file again.',
          });
        }
      }

      if (userId) {
        const creator = await this.userRepository.findOne({
          where: { id: userId },
        });
        if (!creator) {
          throw new NotFoundException({
            code: ErrorCode.USER_NOT_FOUND,
            message: 'No user found.',
          });
        }
        updateFields.creator = creator;
      }

      await queryRunner.manager
        .createQueryBuilder()
        .update(FileEntity)
        .set(updateFields)
        .where('id = :id', { id })
        .execute();

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Post-commit re-read stays outside the try: a read failure here must not
    // attempt a rollback of the already-committed transaction.
    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator'],
    });
    if (!updated) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(updated);
  }

  // 목적: 저장 경로 목록의 물리 파일을 지우고, 남은 것은 경고 로그로 드러낸다.
  // 이유: unlink 실패가 이미 확정된 DB 삭제를 되돌릴 수는 없으므로, 조용히 새는 대신 관측 가능해야 한다.
  // 방법: 공용 unlinkStoredFiles로 file/upload 하위만 best-effort 삭제하고, 실패분을 건별 warn으로 남긴다.
  private async removeStoredFiles(filePaths: string[]): Promise<void> {
    const { failures } = await unlinkStoredFiles(filePaths);
    for (const failure of failures) {
      this.logger.warn(
        `Stored file left on disk: ${failure.filePath} (${failure.reason})`,
      );
    }
  }

  // 목적: 한 유저가 소유한 파일들의 저장 경로를 호출자의 트랜잭션 안에서 읽어 온다.
  // 이유: 계정 삭제는 "파일이 몇 개 남아 있는가"를 먼저 알아야 연쇄 확인(409)을 판정할 수 있다.
  // 방법: 호출자가 넘긴 EntityManager로 creator 기준 조회 후 filePath만 추출한다 — 삭제는 하지 않는다(CQS).
  async findStoredPathsOfCreator(
    manager: EntityManager,
    creatorId: number,
  ): Promise<string[]> {
    const files = await manager.find(FileEntity, {
      where: { creator: { id: creatorId } },
    });
    return files.map((file) => file.filePath);
  }

  // 목적: 한 유저가 소유한 파일 행 전부를 호출자의 트랜잭션 안에서 삭제한다.
  // 이유: FK_file_entity_creator가 ON DELETE NO ACTION이라 유저 행보다 파일 행이 먼저 사라져야 하고,
  //       파일 메타데이터의 삭제 규칙은 UserModule이 아니라 FileModule의 책임이다(모듈 책임 경계).
  // 방법: id 목록이 아니라 creatorId 기준으로 지운다 — 조회 이후 끼어든 업로드까지 포함해야 FK 위반이 남지 않는다.
  async deleteFilesOfCreator(
    manager: EntityManager,
    creatorId: number,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from(FileEntity)
      .where('"creatorId" = :creatorId', { creatorId })
      .execute();
  }

  // 목적: 파일 메타데이터 행과 그에 대응하는 물리 파일을 함께 제거하되, 게시글이 참조 중이면 거절한다.
  // 이유: 행만 지우던 기존 동작은 granted_ 파일을 영구 고아로 남겼고(ADR 0020), 이제는 post가 이 행을
  //       참조할 수 있어 FK 위반이 그대로 500으로 새어 나갈 수 있다(ADR 0023 D4).
  // 방법: 권한 확인 → 행 삭제(23503이면 409 FILE_IN_USE로 번역, 사전 조회는 하지 않는다 — 경합이 남으므로)
  //       → 커밋된 뒤에만 unlink(실패는 warn 로그) → 감사 로그 순서로, 되돌릴 수 없는 작업을 맨 뒤에 둔다.
  async deleteFile(id: number, requester: Requester): Promise<string> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    if (!this.canManage(file.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator or an admin can delete this file.',
      });
    }

    // No pre-check query: asking post_entity here would make FileModule depend on
    // PostModule (a cycle, since PostService already asks this service about ownership)
    // and would still leave a race window. The database is the authority (ADR 0023 D4).
    try {
      await this.fileRepository.delete(id);
    } catch (error) {
      if (this.isPgErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new ConflictException({
          code: ErrorCode.FILE_IN_USE,
          message: 'This file is attached to a post. Delete the post first.',
        });
      }
      throw error;
    }

    // Stored file goes only after the row is gone: unlink cannot be rolled back, so the
    // recoverable failure (an orphan on disk) must be the only one reachable (ADR 0020).
    await this.removeStoredFiles([file.filePath]);

    // Audit after the delete succeeds (side effect isolated from the delete).
    await this.auditLogService.log(requester.id, id, 'FILE_DELETE');

    return `File ${id} deleted.`;
  }
}
