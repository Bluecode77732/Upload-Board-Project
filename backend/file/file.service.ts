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
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { escapeLikePattern } from 'backend/common/escape-like-pattern';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';
import { MetricsService } from 'backend/metrics/metrics.service';

// 행위자의 신원 + role(JWT로부터) — creator-OR-admin 판정에 필요한 만큼만 담는다.
interface Requester {
  id: number;
  role: UserRole;
}

// 청구 시도의 결과: `replayed`는 재시도가 자신의 이전 성공을 그대로 발견했다는 표시로,
// 컨트롤러가 두 번째 201 대신 200으로 응답할 수 있게 한다(ADR 0019).
export interface FileClaimResult {
  replayed: boolean;
  file: FileResponseDto;
}

// Postgres unique_violation. 동시 이중 제출은 설계상 이 경합에서 진다 —
// 서버 결함이 아니라 클라이언트 측 중복이므로 500으로 새어 나가면 안 된다.
const UNIQUE_VIOLATION = '23505';

// Postgres foreign_key_violation. 삭제하려는 파일 행을 게시글이 아직 참조 중일 때 발생한다
// — 서버 결함이 아니라 정당한 클라이언트 결과(409)다(ADR 0023 D4).
const FOREIGN_KEY_VIOLATION = '23503';

// 클라이언트가 지정한 정렬 키를 컬럼으로 잇는 유일한 다리(ADR 0021). FileSortField 전체를
// 커버하는 total Record로 타입을 잡아, 컬럼 매핑 없이 FILE_SORT_FIELDS에 키를 추가하면
// 컴파일이 깨진다 — 화이트리스트가 쿼리와 조용히 어긋날 수 없다.
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

    private readonly metricsService: MetricsService,
  ) {}

  // 파일은 자신의 creator이거나 admin/superadmin이면 관리할 수 있다(RBAC, ADR 0013).
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
  //       mediaType이 응답에 없으면 상세 페이지가 재생 태그를 고를 신호가 없다(ADR 0040 D4). 대기중인
  //       이전 제안이 있으면 소유자(취소용)와 대상 본인(수락/거절용) 둘 다 그걸 알아야 한다(ADR 0050).
  // 방법: private에서 public으로만 올린다 — PostService가 자기 쪽에서 URL을 다시 조립하지 않고 이 메서드에
  //       위임한다. shareUrl은 요청자가 관리 권한을 가진 unlisted 파일에만, 그 외에는 절대 노출하지 않는다.
  //       mediaType은 판정 없이 엔티티 값을 그대로 복사한다 — 판정은 uploadFile 한 곳에서만 한다.
  //       pendingTransferTo는 관리 권한이 있거나 요청자 본인이 그 대상일 때만 노출한다 — 무관한
  //       제3자에게는 이 파일이 이전 대기중이라는 사실 자체를 숨긴다.
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
    const isPendingTarget = !!(
      requester &&
      file.pendingTransferTo &&
      file.pendingTransferTo.id === requester.id
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
      ...((isManager || isPendingTarget) &&
        file.pendingTransferTo && {
          pendingTransferTo: {
            id: file.pendingTransferTo.id,
            email: file.pendingTransferTo.email,
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

    // creator join은 이미 있으므로, 이 필터는 predicate 하나만 더 붙고 추가 쿼리는 없다.
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
    // 정렬 컬럼 값이 같을 때 페이지 경계를 결정론적으로 만들려면 고유한 tiebreaker가 필요하다;
    // id로 정렬하는 경우는 이미 그 자체가 tiebreaker이므로 또 붙이면 절만 중복될 뿐이다.
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
  //       달리 메타데이터 단계에서는 파일의 존재 자체도 확인해 줄 이유가 없기 때문이다. 대기중인 이전
  //       제안의 대상 본인도 통과시켜야 한다 — 새 파일의 기본 visibility가 private인 이상(ADR 0025 D1)
  //       이 예외가 없으면 수락/거절하려는 대상이 그 파일을 볼 수조차 없다(ADR 0050 라이브 검증에서
  //       발견된 결함 — accept/reject가 도달 불가능했다).
  // 방법: 조회 후 public이거나 canManage이거나 요청자가 pendingTransferTo 본인인 경우에만 반환하고,
  //       그 외에는 찾지 못한 것과 동일하게 404. pendingTransferTo도 함께 join해 둔다 — toResponse가
  //       이걸 보고 소유자/대상 본인에게만 노출 여부를 판정한다(ADR 0050).
  async getFileById(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .leftJoinAndSelect('file.pendingTransferTo', 'pendingTransferTo')
      .where('file.id = :id', { id })
      .getOne();

    const isPendingTarget = !!(
      file?.pendingTransferTo && file.pendingTransferTo.id === requester.id
    );

    if (
      !file ||
      (file.visibility !== FileVisibility.public &&
        !this.canManage(file.creator.id, requester) &&
        !isPendingTarget)
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
  //       toResponse에 requester를 넘기지 않으면 isManager가 항상 false가 돼, replay 대상이 unlisted로
  //       생성된 파일이어도 shareUrl이 빠진다 — replay는 항상 그 요청자 본인의 파일이므로(아래에서 이미
  //       확인) 그 요청자를 requester로 넘기지 못할 이유가 없다.
  // 방법: 행의 creator와 요청자 id를 비교 — 일치하면 uploadClaimsTotal{outcome=replayed}를 올리고 기존
  //       리소스를 { id: userId, role: user } 컨텍스트로 toResponse해 replayed로 반환, 아니면
  //       FILE_ALREADY_CLAIMED(ADR 0047 — replay 빈도 관측). role은 무엇을 넣어도 무관하다 —
  //       canManage은 creator.id === requester.id에서 이미 참으로 판정된다.
  private resolveClaim(claim: FileEntity, userId: number): FileClaimResult {
    // 의도적으로 신원만 본다: replay는 원래 제출자의 것이므로, admin이 남의 파일명을
    // 다시 제출하는 건 재시도가 아니라 충돌이다.
    if (claim.creator.id !== userId) {
      throw new ConflictException({
        code: ErrorCode.FILE_ALREADY_CLAIMED,
        message: 'This upload was already claimed.',
      });
    }

    this.metricsService.uploadClaimsTotal.inc({ outcome: 'replayed' });
    return {
      replayed: true,
      file: this.toResponse(claim, { id: userId, role: UserRole.user }),
    };
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

    // 의도적으로 canManage가 아니라 신원만 본다: "게시글은 오직 자기 작성자의 파일만
    // 참조한다"는 규칙이 계정 연쇄 삭제를 FK 안전하게 만드는 전제다(ADR 0023 D1) —
    // admin이 남의 파일을 첨부할 수 있게 하면 이 불변식을 지키는 게 아니라 깨는 셈이다.
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
  //       visibility를 업로드 확정과 동시에 받을 수 있어야 별도 PATCH 왕복 없이 공개범위를 정할 수 있다
  //       (2026-09-06 결정 — rotateShareToken/shareExpiresAt은 이번 스코프에서 의도적으로 제외).
  // 방법: 서버 발급 파일명을 1회용 청구 토큰으로 삼아 선청구 여부를 먼저 판정(replay/409)하고, 미청구일 때만
  //       QueryRunner 트랜잭션 하나로 insert(확장자로 판정한 mediaType 포함) → FileStorage 포트 promote → commit;
  //       실패 시 rollback, release()는 finally. 물리 이동은 어댑터(LocalDiskStorage/S3Storage)에 위임한다
  //       (ADR 0029). visibility는 값이 주어졌을 때만 insert values에 포함해 생략 시 DB 컬럼 기본값
  //       (private)이 그대로 적용되도록 하고, 'unlisted'로 들어오면 updateFile과 동일하게
  //       generateShareToken()으로 shareToken을 함께 insert한다. 재조회는 updateFile과 동일하게
  //       relations: ['creator']를 포함해 두 쓰기 경로의 응답 모양을 통일한다. toResponse에는
  //       { id: userId, role: user } requester를 넘겨 isManager를 참으로 만든다 — 그래야 방금 만든
  //       unlisted 파일의 shareUrl이 이 응답에 바로 실린다(라이브 검증 중 발견한 갭 — 없으면 생성 직후
  //       GET /file/:id를 한 번 더 불러야 했다). 신규 승격 성공 시 uploadClaimsTotal{outcome=fresh}를
  //       올린다(ADR 0047).
  async uploadFile(
    uploadFileDto: UploadFileDto,
    userId: number,
  ): Promise<FileClaimResult> {
    const storedPath = this.toStoredPath(uploadFileDto.filePath);

    // 이미 성공한 요청의 재시도는 트랜잭션을 아예 열지 않아야 한다.
    const existingClaim = await this.findClaim(storedPath);
    if (existingClaim) {
      return this.resolveClaim(existingClaim, userId);
    }

    // 이 파일명을 청구한 행도 없고 뒤에 temp 객체도 없다: 애초에 발급된 적 없거나
    // TTL이 지나 스윕됐거나(ADR 0018) 둘 중 하나 — 서버 결함이 아니라 클라이언트 측
    // 전제조건 실패다.
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
      // title은 unique다 — 사전 체크를 해 둬야 DB 제약 위반이 타입 없는 500에 묻히지 않고
      // 타입 있는 FILE_TITLE_TAKEN으로 드러난다(updateFile과 동일한 패턴).
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
          // 값이 주어지지 않으면 아예 넣지 않는다 — 그래야 이 필드가 생기기 전과 똑같이
          // DB 컬럼 기본값(private)이 그대로 적용된다(회귀 없음).
          ...(uploadFileDto.visibility !== undefined
            ? { visibility: uploadFileDto.visibility }
            : {}),
          // updateFile의 enteringUnlisted 분기와 동일하다: 새로 만드는 unlisted 파일도
          // 후속 PATCH가 아니라 같은 트랜잭션 안에서 토큰을 발급받아야 한다.
          ...(uploadFileDto.visibility === FileVisibility.unlisted
            ? { shareToken: this.generateShareToken() }
            : {}),
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
      // 타입 있는 도메인 예외(예: FILE_TITLE_TAKEN)는 그대로 보존한다 — 정체불명 실패만
      // 일반 메시지로 뭉뚱그려 내부 정보가 새지 않게 한다.
      if (error instanceof HttpException) throw error;

      // title 사전 체크는 잠금 없는 읽기라, 동시 제출 둘 다 이걸 통과하고 unique 제약이
      // 승자를 가릴 수 있다. 승자가 바로 이 파일명을 청구한 것이라면, 패자는 같은 요청이
      // 두 번 온 것이므로 에러 대신 replay로 처리한다.
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

    // 커밋 후 재조회는 try 밖에 둔다: 여기서 읽기가 실패해도 이미 커밋된 트랜잭션을
    // 롤백하려 들면 안 된다. relations: ['creator']는 updateFile의 재조회와 맞춰서
    // 두 쓰기 경로가 같은 응답 모양을 돌려주게 한다.
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
    this.metricsService.uploadClaimsTotal.inc({ outcome: 'fresh' });
    return {
      replayed: false,
      file: this.toResponse(saved, { id: userId, role: UserRole.user }),
    };
  }

  // 목적: 파일 메타데이터(제목/경로/가시성)를 갱신한다.
  // 이유: 가시성 토글(ADR 0025 D1)이 새 엔드포인트가 아니라 기존 소유자-가드 쓰기 경로를 재사용하도록
  //       결정됐으므로, 공유 토큰 발급/회전/폐기도 같은 트랜잭션에 들어가야 한다. 소유권 이전은
  //       더 이상 여기 없다 — 동의 없는 즉시 강제 이전이었던 옛 userId 필드는 제거됐고, 대신
  //       proposeTransfer/acceptTransfer/rejectTransfer/cancelTransfer가 그 자리를 대신한다(ADR 0050).
  //       title 사전 체크(459-468행)는
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

      // creator 또는 admin만 수정할 수 있다. 소유권 자체는 더 이상 이 메서드로 옮겨지지 않는다 —
      // proposeTransfer/acceptTransfer 참고(ADR 0050).
      if (!this.canManage(file.creator.id, requester)) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN_NOT_OWNER,
          message: 'Only the file creator or an admin can update this file.',
        });
      }

      const { title, filePath } = updateFileDto;
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
        // 새로 unlisted가 되거나 명시적으로 회전을 요청한 경우: 새 토큰을 발급하면
        // 이전에 공유됐던 링크는 전부 무효화된다(ADR 0025 D3).
        updateFields.shareToken = this.generateShareToken();
        updateFields.shareExpiresAt = null;
      } else if (!enteringUnlisted && file.shareToken !== null) {
        // unlisted를 벗어나거나(또는 애초에 unlisted가 아니었다면) 토큰이 남아있으면 안 된다.
        updateFields.shareToken = null;
        updateFields.shareExpiresAt = null;
      }

      // 파일이 unlisted이거나 unlisted가 될 때만 의미가 있다 — 그 외에는 묶을 토큰
      // 자체가 없으므로 조용히 아무 효과도 없다.
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
      // 위의 title 사전 체크는 잠금 없는 읽기라, 같은 title로 경합하는 동시 PATCH 둘 다
      // unique 제약이 승자를 정하기 전에 통과할 수 있다. 이 레이스만 가로채고, 그 외
      // 모든 에러(위에서 던진 타입 있는 HttpException 포함)는 예전처럼 그대로 rethrow한다.
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

    // 커밋 후 재조회는 try 밖에 둔다: 여기서 읽기가 실패해도 이미 커밋된 트랜잭션을
    // 롤백하려 들면 안 된다.
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

  // 목적: creator/admin이 파일 소유권을 특정 대상에게 이전하자고 제안한다 — 소유권은 이 시점에
  //       바뀌지 않는다.
  // 이유: 옛 즉시-강제 이전(UpdateFileDto.userId)은 수신자 동의 없이 소유권을 바꿔서, 그 결과가
  //       ADR 0024가 흡수해야 했던 invariant 붕괴의 유일한 원인이었다. 제안 단계를 분리해 동의
  //       없는 이전 자체를 구조적으로 불가능하게 만든다(ADR 0050 D1).
  // 방법: canManage로 권한 확인 → 자기 자신을 대상으로 지정하면 거부 → 대상 유저 존재 확인 →
  //       이미 대기중이면 409(D3 — 자동 덮어쓰기 없음, 먼저 취소해야 함) → pendingTransferToUserId만
  //       갱신, creator는 그대로.
  async proposeTransfer(
    id: number,
    targetUserId: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
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
        message: 'Only the file creator or an admin can propose a transfer.',
      });
    }

    if (targetUserId === file.creator.id) {
      throw new BadRequestException({
        code: ErrorCode.FILE_TRANSFER_INVALID_TARGET,
        message: 'Cannot propose a transfer to the current owner.',
      });
    }

    if (file.pendingTransferTo) {
      throw new ConflictException({
        code: ErrorCode.FILE_TRANSFER_PENDING,
        message: `A transfer to user ${file.pendingTransferTo.id} is already pending. Cancel it before proposing a new target.`,
      });
    }

    const target = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'No user found.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: target })
      .where('id = :id', { id })
      .execute();

    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });
    if (!updated) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(updated, requester);
  }

  // 목적: 대기중인 이전 제안을 대상 유저 본인이 수락해 실제로 소유권을 넘긴다 — 이 시점에만
  //       creator가 실제로 바뀐다.
  // 이유: 동의 없는 강제 이전을 막는 것이 ADR 0050의 핵심이다 — admin을 포함해 오직 대상 본인만
  //       수락할 수 있다(D4). 감사 로그도 제안이 아니라 이 실제 상태 변화 시점에만 남긴다(D6) —
  //       이전 소유자의 계정이 나중에 삭제되면 이 로그가 원래 소유자를 알 수 있는 유일한 곳이다.
  // 방법: 대기중인 제안이 없으면 400 → 요청자가 대상이 아니면 403(제3자는 파일이 대기중이라는
  //       사실조차 알면 안 되므로 존재 확인보다 먼저 대상 일치부터 본다) → creator를 대상으로,
  //       pendingTransferToUserId를 null로 같은 쓰기에서 갱신 → 커밋 후 FILE_TRANSFER 감사 로그.
  async acceptTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    if (file.pendingTransferTo.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET,
        message: 'Only the proposed recipient can accept this transfer.',
      });
    }

    const newOwner = file.pendingTransferTo;
    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ creator: newOwner, pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    await this.auditLogService.log(
      requester.id,
      id,
      AuditTargetType.file,
      'FILE_TRANSFER',
      `from=${file.creator.id} to=${newOwner.id}`,
    );

    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });
    if (!updated) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(updated, requester);
  }

  // 목적: 대기중인 이전 제안을 대상 유저 본인이 거절한다 — 소유권은 바뀌지 않는다.
  // 이유: acceptTransfer와 대칭인 경로. 거절도 동의 절차의 일부이므로 오직 대상 본인만 할 수
  //       있다(ADR 0050 D1).
  // 방법: acceptTransfer와 같은 대기 상태·권한 검사 → pendingTransferToUserId만 null로 되돌림,
  //       creator는 손대지 않음. 감사 로그 없음(D6 — 실제 소유권 변화가 없으므로).
  async rejectTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    if (file.pendingTransferTo.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET,
        message: 'Only the proposed recipient can reject this transfer.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });
    if (!updated) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(updated, requester);
  }

  // 목적: 제안자 본인이 아직 응답 없는 제안을 취소한다 — 소유권은 바뀌지 않는다.
  // 이유: A가 대상을 잘못 지정했거나 마음이 바뀌었을 때, B의 거절을 기다리지 않고 스스로 거둘 수
  //       있어야 한다(ADR 0050 D1) — D3의 "새로 제안하려면 먼저 취소" 규칙이 실제로 쓰이는 경로다.
  //       admin은 제외한다 — canManage()는 "내 리소스를 내가 관리"를 전제한 모더레이션 게이트인데,
  //       제안은 A·B 두 당사자 간의 합의 절차라 제3자(admin)가 개입할 근거가 없다. 이전엔 propose와
  //       같은 canManage 검사를 그대로 재사용해 admin이 남의 제안을 임의로 취소할 수 있었는데, 이건
  //       설계된 적 없는 상속이었다(옛 `PATCH /file/:id { userId }`가 근거 없이 존재했던 것과 같은
  //       종류의 결함). admin이 정말 막아야 하면 그 파일을 `DELETE /file/:id`로 지우면 된다 —
  //       propose(D4)는 admin도 여전히 가능, cancel만 creator 전용으로 좁힌다.
  // 방법: creator 본인 여부만 확인(admin 우회 없음) → 대기중이 아니면 400 → pendingTransferToUserId만 null로.
  async cancelTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    if (file.creator.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator can cancel a transfer.',
      });
    }

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
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
        // 연쇄 삭제 순서상 이 시점엔 이미 계정 본인의 게시글은 다 사라졌으므로,
        // 여전히 이 파일들을 참조하는 게 있다면 그건 확실히 남의 게시글이다.
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

    // 사전 조회 쿼리는 없다: 여기서 post_entity를 물어보면 FileModule이 PostModule에
    // 의존하게 되고(PostService가 이미 소유권을 이 서비스에 묻고 있으니 순환이 된다),
    // 그래도 경합 창은 여전히 남는다. DB가 최종 권위다(ADR 0023 D4).
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

    // 위 findOne 읽기와 이 delete 사이에 동시 삭제 요청이 먼저 행을 지운 경우다:
    // 이미 사라진 행에 대해 unlink나 감사 로그를 또 실행하면 둘 다 중복되므로,
    // 그냥 "찾을 수 없음"과 동일한 404로 처리한다.
    if (deleteResult.affected === 0) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    // 저장된 파일은 행이 사라진 뒤에만 지운다: unlink는 롤백할 수 없으므로, 도달 가능한
    // 유일한 실패는 복구 가능한 것(디스크에 남는 고아)이어야 한다(ADR 0020).
    await this.removeStoredFiles([file.filePath]);

    // 삭제가 성공한 뒤에 감사 로그를 남긴다(부수 효과를 삭제 자체와 분리).
    await this.auditLogService.log(
      requester.id,
      id,
      AuditTargetType.file,
      'FILE_DELETE',
    );

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

    // unlisted: 소유자/admin은 토큰 없이 그냥 통과한다; 그 외에는 유효하고 만료되지 않은
    // 공유 토큰이 있어야 한다 — 로그인은 필요 없다(ADR 0025 D1/D2).
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
