import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import {
  DataSource,
  DeleteResult,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { UserEntity } from 'backend/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { FileVisibility } from './entity/file-visibility.enum';
import { FileMediaType } from './entity/file-media-type.enum';
import path, { join } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { FileSortField, GetFilesDto } from './dto/get-files.dto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';

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

    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage,
  ) {}

  // A file is manageable by its creator, or by an admin/superadmin (RBAC, ADR 0013).
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  // 목적: unlisted 파일의 공유 토큰으로 쓸 서버 발급 랜덤 opaque 문자열을 만든다.
  // 이유: 추측 가능한 id는 링크 공유의 보안 전제를 깨고(ADR 0025 D3), 회전이 곧 무효화 수단이 되려면
  //       매번 예측 불가능한 새 값이어야 한다.
  // 방법: crypto.randomBytes(32)를 base64url로 인코딩 — URL 쿼리에 그대로 넣을 수 있는 형태.
  private generateShareToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // 목적: 요청으로 들어온 공유 토큰이 저장된 토큰과 일치하는지 판정한다.
  // 이유: 비밀 토큰 비교는 타이밍 사이드채널에 노출되면 안 된다(Never Do G3, Secure by Default).
  // 방법: 길이가 다르면 즉시 거부하고, 같을 때만 timingSafeEqual로 상수 시간 비교한다.
  private isValidShareToken(candidate: string, actual: string): boolean {
    const candidateBuffer = Buffer.from(candidate);
    const actualBuffer = Buffer.from(actual);
    if (candidateBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(candidateBuffer, actualBuffer);
  }

  // 목적: FileEntity를 공개 URL이 붙은 응답 DTO로 변환한다.
  // 이유: BASE_URL 합성은 한 곳에만 있어야 하는데, 게시글 응답도 첨부 파일 URL을 담아야 한다(ADR 0023).
  //       fileUrl은 이제 정적 경로가 아니라 접근 검사를 거치는 콘텐츠 엔드포인트를 가리킨다(ADR 0025 D2).
  //       mediaType이 응답에 없으면 상세 페이지가 재생 태그를 고를 신호가 없다(ADR 0040 D4).
  // 방법: private에서 public으로만 올린다 — PostService가 자기 쪽에서 URL을 다시 조립하지 않고 이 메서드에
  //       위임한다. shareUrl은 요청자가 관리 권한을 가진 unlisted 파일에만, 그 외에는 절대 노출하지 않는다.
  //       mediaType은 판정 없이 엔티티 값을 그대로 복사한다 — 판정은 uploadFile 한 곳에서만 한다.
  toResponse(file: FileEntity, requester?: Requester): FileResponseDto {
    const baseUrl = this.configService.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
    const contentUrl = `${baseUrl}/file/${file.id}/content`;
    const isManager = !!(
      requester &&
      file.creator &&
      this.canManage(file.creator.id, requester)
    );

    return {
      id: file.id,
      title: file.title,
      fileUrl: contentUrl,
      visibility: file.visibility,
      mediaType: file.mediaType,
      ...(isManager &&
        file.visibility === FileVisibility.unlisted &&
        file.shareToken && {
          shareUrl: `${contentUrl}?share=${file.shareToken}`,
        }),
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
  //       중복·누락까지 가능했다(정렬 없는 OFFSET은 순서가 미정의). private/unlisted 파일의 제목·작성자
  //       메타데이터가 소유자·admin 외에게 새는 것은 '비공개' 토글의 취지를 무력화한다(ADR 0025).
  // 방법: 기존 QueryBuilder에 조건만 조립 — 검색어는 와일드카드를 이스케이프한 ILIKE, 정렬 컬럼은
  //       SORT_COLUMN 매핑으로만 결정하고, id를 tiebreaker로 덧붙여 페이징을 안정화한다. admin이 아니면
  //       public이거나 본인 소유인 행만 남긴다.
  async getFiles(
    query: GetFilesDto,
    requester: Requester,
  ): Promise<[FileResponseDto[], number]> {
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

    if (ROLE_RANK[requester.role] < ROLE_RANK[UserRole.admin]) {
      queryBuilder.andWhere(
        '(file.visibility = :publicVisibility OR creator.id = :requesterId)',
        { publicVisibility: FileVisibility.public, requesterId: requester.id },
      );
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
    return [files.map((f) => this.toResponse(f, requester)), count];
  }

  // 목적: 단일 파일 메타데이터를 조회하되, 볼 권한이 없으면 존재 자체를 숨긴다.
  // 이유: private/unlisted 파일의 제목·작성자를 소유자·admin 외에게 보여주면 '비공개' 토글이 이름뿐인
  //       상태가 된다(ADR 0025). 403이 아니라 404를 쓰는 이유는 콘텐츠 접근 거부(FORBIDDEN_NOT_OWNER)와
  //       달리 메타데이터 단계에서는 파일의 존재 자체도 확인해 줄 이유가 없기 때문이다.
  // 방법: 조회 후 public이거나 canManage인 경우에만 반환하고, 그 외에는 찾지 못한 것과 동일하게 404.
  async getFileById(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (
      !file ||
      (file.visibility !== FileVisibility.public &&
        !this.canManage(file.creator.id, requester))
    ) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    return this.toResponse(file, requester);
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

  // 목적: 저장 경로의 확장자로부터 매체 종류(image/audio/video)를 판정한다.
  // 이유: 상세 페이지가 옳은 재생 태그를 고르려면 매체 종류가 DB에 영속돼야 하는데(ADR 0040 D2),
  //       확장자는 TEMP_FILENAME_PATTERN으로 이미 검증된 서버 발급 값이므로 클라이언트를 다시
  //       신뢰할 필요가 없다.
  // 방법: TEMP_FILENAME_PATTERN과 동일한 세 확장자 그룹으로 분기 — 그 외(mp4/mov/webm)는 video.
  private mediaTypeFromExtension(storedPath: string): FileMediaType {
    const extension = storedPath.split('.').pop()?.toLowerCase() ?? '';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      return FileMediaType.image;
    }
    if (extension === 'mp3') {
      return FileMediaType.audio;
    }
    return FileMediaType.video;
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
  // 이유: DB 저장과 물리 승격이 따로 실패하면 행이 없는 파일을 가리키고, 재시도는 모호한 400이나 500을 받는다.
  //       post-commit 재조회에 relations: ['creator']가 빠지면 신규 생성(201) 응답만 creator가 없어
  //       updateFile의 응답 모양과 달라진다. mediaType이 비면 상세 페이지가 재생 태그를 고를 수 없다(ADR 0040).
  // 방법: 서버 발급 파일명을 1회용 청구 토큰으로 삼아 선청구 여부를 먼저 판정(replay/409)하고, 미청구일 때만
  //       QueryRunner 트랜잭션 하나로 insert(확장자로 판정한 mediaType 포함) → FileStorage 포트 promote → commit;
  //       실패 시 rollback, release()는 finally. 물리 이동은 어댑터(LocalDiskStorage/S3Storage)에 위임한다
  //       (ADR 0029). 재조회는 updateFile과 동일하게 relations: ['creator']를 포함해 두 쓰기 경로의 응답
  //       모양을 통일한다.
  async uploadFile(
    uploadFileDto: UploadFileDto,
    userId: number,
  ): Promise<FileClaimResult> {
    const storedPath = this.toStoredPath(uploadFileDto.filePath);

    // A retry of an already-succeeded request must not open a transaction at all.
    const existingClaim = await this.findClaim(storedPath);
    if (existingClaim) {
      return this.resolveClaim(existingClaim, userId);
    }

    // Nothing claims the filename and no temp object backs it: never issued, or swept
    // past its TTL (ADR 0018). That is a client precondition failure, not a 500.
    const tempExists = await this.storage.existsTemp(uploadFileDto.filePath);
    if (!tempExists) {
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
          mediaType: this.mediaTypeFromExtension(storedPath),
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

      await this.storage.promote(uploadFileDto.filePath, storedPath);

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
    // attempt a rollback of the already-committed transaction. relations: ['creator']
    // mirrors updateFile's re-read so both write paths return the same response shape.
    const saved = await this.fileRepository.findOne({
      where: { id: fileId },
      relations: ['creator'],
    });
    if (!saved) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return { replayed: false, file: this.toResponse(saved) };
  }

  // 목적: 파일 메타데이터(제목/경로/소유자/가시성)를 갱신한다.
  // 이유: 가시성 토글(ADR 0025 D1)이 새 엔드포인트가 아니라 기존 소유자-가드 쓰기 경로를 재사용하도록
  //       결정됐으므로, 공유 토큰 발급/회전/폐기도 같은 트랜잭션에 들어가야 한다. title 사전 체크(459-468행)는
  //       잠금 없는 읽기라 동시에 같은 title로 PATCH하는 요청 둘이 모두 통과할 수 있고, uploadFile과 달리
  //       catch에서 이를 걸러내지 않으면 UNIQUE 위반이 타입 없는 500으로 새어 나간다(AllExceptionsFilter는
  //       HttpException이 아닌 에러를 전부 INTERNAL_ERROR로 뭉갠다).
  // 방법: 단일 QueryRunner 트랜잭션(기존 패턴 유지) 안에서 필드를 갱신 — visibility가 'unlisted'로
  //       진입할 때만(또는 rotateShareToken 명시 시) 새 토큰을 발급하고, 벗어나면 토큰/만료를 비운다.
  //       catch에서 isPgErrorCode(error, UNIQUE_VIOLATION)만 가로채 400 FILE_TITLE_TAKEN으로 번역한다 —
  //       PATCH의 title은 uploadFile의 filePath 같은 1회용 청구 토큰이 아니라 임의 필드 갱신이므로
  //       승자를 재조회해 replay 판정을 하지 않고, 다른 모든 에러는 기존처럼 그대로 rethrow한다.
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

      const { visibility, rotateShareToken, shareExpiresAt } = updateFileDto;
      if (visibility !== undefined) {
        updateFields.visibility = visibility;
      }
      const targetVisibility = updateFields.visibility ?? file.visibility;
      const enteringUnlisted = targetVisibility === FileVisibility.unlisted;

      if (
        enteringUnlisted &&
        (file.visibility !== FileVisibility.unlisted || rotateShareToken)
      ) {
        // Newly unlisted, or an explicit rotation: a fresh token invalidates any
        // previously shared link (ADR 0025 D3).
        updateFields.shareToken = this.generateShareToken();
        updateFields.shareExpiresAt = null;
      } else if (!enteringUnlisted && file.shareToken !== null) {
        // Leaving (or never entering) unlisted: no token should remain.
        updateFields.shareToken = null;
        updateFields.shareExpiresAt = null;
      }

      // Only meaningful once the file is (or becomes) unlisted — silently has no
      // effect otherwise, since there is no token for it to bound.
      if (shareExpiresAt !== undefined && enteringUnlisted) {
        updateFields.shareExpiresAt = new Date(shareExpiresAt);
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
      // The title precheck above is an unlocked read; a concurrent PATCH racing on the
      // same title can both pass it before the unique constraint picks a winner. Only
      // that race is intercepted — every other error (including the typed HttpExceptions
      // thrown above) rethrows unchanged, as before.
      if (this.isPgErrorCode(error, UNIQUE_VIOLATION)) {
        throw new BadRequestException({
          code: ErrorCode.FILE_TITLE_TAKEN,
          message: 'Title already in use.',
        });
      }
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
    return this.toResponse(updated, requester);
  }

  // 목적: 저장 경로 목록의 물리 파일을 지우고, 남은 것은 경고 로그로 드러낸다.
  // 이유: unlink 실패가 이미 확정된 DB 삭제를 되돌릴 수는 없으므로, 조용히 새는 대신 관측 가능해야 한다.
  // 방법: FileStorage 포트로 best-effort 삭제하고(경로 안전성 검사는 어댑터 책임, ADR 0029), 실패분을 건별 warn으로 남긴다.
  private async removeStoredFiles(filePaths: string[]): Promise<void> {
    const { failures } = await this.storage.unlink(filePaths);
    for (const failure of failures) {
      this.logger.warn(
        `Stored file left on disk: ${failure.key} (${failure.reason})`,
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

  // 목적: 한 유저가 소유한 파일 행 전부를 호출자의 트랜잭션 안에서 삭제하되, 남의 게시글이 참조 중이면 거절한다.
  // 이유: FK_file_entity_creator가 ON DELETE NO ACTION이라 유저 행보다 파일 행이 먼저 사라져야 하고,
  //       소유권 재배정(PATCH /file/:id userId) 이후에는 타인의 게시글이 이 파일을 참조할 수 있어
  //       FK 위반이 그대로 500으로 새어 나갈 수 있다(ADR 0024).
  // 방법: id 목록이 아니라 creatorId 기준으로 지운다 — 조회 이후 끼어든 업로드까지 포함해야 FK 위반이 남지 않는다.
  //       23503은 409 USER_FILES_IN_USE로 번역한다(사전 조회는 하지 않는다 — 모듈 순환이자 경합).
  async deleteFilesOfCreator(
    manager: EntityManager,
    creatorId: number,
  ): Promise<void> {
    try {
      await manager
        .createQueryBuilder()
        .delete()
        .from(FileEntity)
        .where('"creatorId" = :creatorId', { creatorId })
        .execute();
    } catch (error) {
      if (this.isPgErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        // The account's own posts are already gone by this point in the cascade order,
        // so whatever still references these files provably belongs to someone else.
        throw new ConflictException({
          code: ErrorCode.USER_FILES_IN_USE,
          message:
            "A file owned by this account is attached to another user's post. Delete that post first.",
        });
      }
      throw error;
    }
  }

  // 목적: 파일 메타데이터 행과 그에 대응하는 물리 파일을 함께 제거하되, 게시글이 참조 중이면 거절한다.
  // 이유: 행만 지우던 기존 동작은 granted_ 파일을 영구 고아로 남겼고(ADR 0020), 이제는 post가 이 행을
  //       참조할 수 있어 FK 위반이 그대로 500으로 새어 나갈 수 있다(ADR 0023 D4). findOne과 delete 사이의
  //       경합 창에서 동시 삭제 요청이 먼저 행을 지우면 affected가 0인데도 unlink/감사 로그를 또 실행해
  //       FILE_DELETE 감사 로그가 중복될 수 있다.
  // 방법: 권한 확인 → 행 삭제(23503이면 409 FILE_IN_USE로 번역, 사전 조회는 하지 않는다 — 경합이 남으므로)
  //       → affected === 0이면(동시 삭제로 이미 사라짐) unlink/감사 로그를 건너뛰고 404로 처리(uploadFile의
  //       post-commit 재조회 실패 패턴과 동일) → 커밋된 뒤에만 unlink(실패는 warn 로그) → 감사 로그 순서로,
  //       되돌릴 수 없는 작업을 맨 뒤에 둔다.
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
    let deleteResult: DeleteResult;
    try {
      deleteResult = await this.fileRepository.delete(id);
    } catch (error) {
      if (this.isPgErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new ConflictException({
          code: ErrorCode.FILE_IN_USE,
          message: 'This file is attached to a post. Delete the post first.',
        });
      }
      throw error;
    }

    // A concurrent delete already removed the row between the findOne read above and
    // this delete: unlinking or auditing again would duplicate both for a row that is
    // already gone, so report the same 404 as "not found" instead.
    if (deleteResult.affected === 0) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    // Stored file goes only after the row is gone: unlink cannot be rolled back, so the
    // recoverable failure (an orphan on disk) must be the only one reachable (ADR 0020).
    await this.removeStoredFiles([file.filePath]);

    // Audit after the delete succeeds (side effect isolated from the delete).
    await this.auditLogService.log(requester.id, id, 'FILE_DELETE');

    return `File ${id} deleted.`;
  }

  // 목적: GET /file/:id/content가 실제로 바이트를 스트리밍해도 되는지 가시성 규칙으로 판정한다.
  // 이유: file/upload 정적 서빙이 중단되므로(ADR 0025 D2) 모든 granted 읽기가 이 판정을 반드시 거쳐야
  //       "private=소유자/admin만, unlisted=토큰 소지자만"이라는 D1 계약이 실제로 성립한다.
  // 방법: public은 무조건 통과, private는 canManage만, unlisted는 소유자/admin 우회 또는 토큰 일치+
  //       미만료만 통과시킨다 — 실패는 전부 403(존재는 확인해 주되 접근만 거부, D6)으로 통일한다.
  async resolveContentAccess(
    id: number,
    requester: Requester | null,
    shareToken?: string,
  ): Promise<FileEntity> {
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

    if (file.visibility === FileVisibility.public) {
      return file;
    }

    const isManager = !!(
      requester && this.canManage(file.creator.id, requester)
    );

    if (file.visibility === FileVisibility.private) {
      if (isManager) return file;
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator or an admin can access this file.',
      });
    }

    // unlisted: owner/admin bypass the token entirely; anyone else needs a valid,
    // unexpired share token — no login required (ADR 0025 D1/D2).
    if (isManager) return file;

    const expired =
      file.shareExpiresAt !== null &&
      file.shareExpiresAt.getTime() < Date.now();

    if (
      !shareToken ||
      !file.shareToken ||
      expired ||
      !this.isValidShareToken(shareToken, file.shareToken)
    ) {
      throw new ForbiddenException({
        code: ErrorCode.FILE_SHARE_INVALID,
        message: 'Missing, invalid, or expired share token.',
      });
    }

    return file;
  }
}
