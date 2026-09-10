import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Repository,
  QueryRunner,
  QueryFailedError,
  SelectQueryBuilder,
} from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { FileVisibility } from './entity/file-visibility.enum';
import { FileMediaType } from './entity/file-media-type.enum';
import { GetFilesDto } from './dto/get-files.dto';
import { UserEntity } from 'backend/user/entity/user.entity';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import {
  FILE_STORAGE,
  FileStorage,
} from 'backend/storage/file-storage.interface';
import { MetricsService } from 'backend/metrics/metrics.service';

// mockFileEntity.creator.id === 1이므로 `owner`는 소유권으로 관리 가능; `stranger`
// (creator가 아닌 일반 user)는 금지; `admin`은 role로 관리 가능(RBAC).
const owner = { id: 1, role: UserRole.user };
const stranger = { id: 2, role: UserRole.user };
const admin = { id: 9, role: UserRole.admin };

describe('FileService', () => {
  let fileService: FileService;
  let fileRepository: Repository<FileEntity>;
  let userRepository: Repository<UserEntity>;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  const mockAuditLogService = {
    log: jest.fn(),
  };

  const mockMetricsService = {
    uploadClaimsTotal: { inc: jest.fn() },
  };

  const mockStorage: jest.Mocked<FileStorage> = {
    saveTemp: jest.fn(),
    existsTemp: jest.fn(),
    promote: jest.fn(),
    stat: jest.fn(),
    createReadStream: jest.fn(),
    unlink: jest.fn(),
    listTemp: jest.fn(),
  };

  const mockFileEntity: FileEntity = {
    id: 1,
    title: 'Test File',
    filePath: 'file/upload/granted_test.mp4',
    creator: { id: 1, email: 'creator@test.com' } as UserEntity,
    visibility: FileVisibility.public,
    mediaType: FileMediaType.video,
    shareToken: null,
    shareExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
        findOne: jest.fn(),
      },
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const mockFileRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getRepositoryToken(FileEntity),
          useValue: mockFileRepository,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: FILE_STORAGE,
          useValue: mockStorage,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    }).compile();

    fileService = module.get<FileService>(FileService);
    fileRepository = module.get<Repository<FileEntity>>(
      getRepositoryToken(FileEntity),
    );
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    dataSource = module.get<DataSource>(DataSource);
    queryRunner = dataSource.createQueryRunner();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadFile', () => {
    const uploadFileDto = {
      title: 'New Video',
      filePath: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
    };
    // 그 파일명을 첫 번째로 성공 청구했을 때 남는 행.
    const claimedFile: FileEntity = {
      ...mockFileEntity,
      filePath:
        'file/upload/granted_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
    };

    const insertQueryBuilder = (
      execute: jest.Mock,
    ): Record<string, jest.Mock> => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute,
    });

    // TypeORM이 드러내는 형태의 Postgres unique_violation(driverError.code).
    const uniqueViolation = () =>
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

    beforeEach(() => {
      // temp 객체 존재 확인이 기본적으로 통과하게 만든다(mock 구현체는
      // clearAllMocks에도 살아남으므로, 테스트 실행마다 다시 설정한다).
      mockStorage.existsTemp.mockResolvedValue(true);
      mockStorage.promote.mockResolvedValue(undefined);
    });

    it('should successfully upload a file', async () => {
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      // findOne 호출 순서: 청구 사전 체크(미청구), 중복 제목 사전 체크, 커밋 후 재조회.
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result.replayed).toBe(false);
      expect(result.file).toMatchObject({
        id: 1,
        title: 'Test File',
        fileUrl: 'http://localhost:3000/file/1/content',
        // 커밋 후 재조회는 creator relation을 반드시 로드해야 방금 승격된 파일의
        // 응답 모양이 updateFile의 것과 일치한다.
        creator: { id: 1, email: 'creator@test.com' },
      });
      expect(fileRepository.findOne).toHaveBeenNthCalledWith(3, {
        where: { id: 1 },
        relations: ['creator'],
      });
      // insert는 uploadFileDto.filePath 자체의 .mp4 확장자로부터 mediaType을 판정한다 —
      // 클라이언트가 넘긴 필드에서 가져오는 게 아니다(ADR 0040 D2).
      expect(builder.values).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: FileMediaType.video }),
      );
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(mockStorage.promote).toHaveBeenCalled();
    });

    it('derives mediaType image for a jpg upload, not the field the temp filename happens to use', async () => {
      const imageDto = {
        title: 'New Image',
        filePath: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.jpg',
      };
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await fileService.uploadFile(imageDto, 1);

      expect(builder.values).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: FileMediaType.image }),
      );
    });

    it('derives mediaType audio for an mp3 upload', async () => {
      const audioDto = {
        title: 'New Audio',
        filePath: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp3',
      };
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await fileService.uploadFile(audioDto, 1);

      expect(builder.values).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: FileMediaType.audio }),
      );
    });

    it('defaults to private when visibility is omitted (no regression)', async () => {
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await fileService.uploadFile(uploadFileDto, 1);

      const valuesMock = builder.values as unknown as jest.Mock<
        unknown,
        [Record<string, unknown>]
      >;
      const insertedValues = valuesMock.mock.calls[0][0];
      expect(insertedValues).not.toHaveProperty('visibility');
      expect(insertedValues).not.toHaveProperty('shareToken');
    });

    it('applies an explicit public visibility at creation', async () => {
      const publicDto = { ...uploadFileDto, visibility: FileVisibility.public };
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await fileService.uploadFile(publicDto, 1);

      expect(builder.values).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: FileVisibility.public }),
      );
    });

    it('generates a share token when visibility is unlisted at creation', async () => {
      const unlistedDto = {
        ...uploadFileDto,
        visibility: FileVisibility.unlisted,
      };
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await fileService.uploadFile(unlistedDto, 1);

      const valuesMock = builder.values as unknown as jest.Mock<
        unknown,
        [Record<string, unknown>]
      >;
      const insertedValues = valuesMock.mock.calls[0][0];
      expect(insertedValues.visibility).toBe(FileVisibility.unlisted);
      expect(typeof insertedValues.shareToken).toBe('string');
      expect((insertedValues.shareToken as string).length).toBeGreaterThan(0);
    });

    it('includes shareUrl in the fresh-creation response for an unlisted upload', async () => {
      // 라이브 검증에서 발견한 사실: toResponse()는 requester가 넘어오고 그것에 대해
      // canManage()가 true일 때만 shareUrl을 포함한다 — 방금 승격된 파일의 creator는
      // 항상 자기 자신의 manager이므로, 응답은 그 requester를 생략하지 않고 담아야 한다.
      const unlistedDto = {
        ...uploadFileDto,
        visibility: FileVisibility.unlisted,
      };
      const unlistedSavedRow: FileEntity = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'test-share-token',
      };
      const builder = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      );
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(builder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(unlistedSavedRow);

      const result = await fileService.uploadFile(unlistedDto, 1);

      expect(result.file.shareUrl).toBe(
        'http://localhost:3000/file/1/content?share=test-share-token',
      );
    });

    it('should replay the existing file when the same user resubmits a claimed filename', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(claimedFile);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result.replayed).toBe(true);
      expect(result.file).toMatchObject({ id: 1, title: 'Test File' });
      // 이미 성공한 요청의 재시도는 트랜잭션을 열지도, 파일을 옮기지도 않는다.
      expect(queryRunner.connect).not.toHaveBeenCalled();
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(mockStorage.promote).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (FILE_ALREADY_CLAIMED) when another user claimed the filename', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(claimedFile);

      await expect(fileService.uploadFile(uploadFileDto, 2)).rejects.toThrow(
        ConflictException,
      );
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(mockStorage.promote).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException (FILE_INVALID_PATH) when the temp file no longer exists', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(null);
      mockStorage.existsTemp.mockResolvedValue(false);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      // 아무것도 쓰이지 않는다: 트랜잭션이 열리기 전에 전제조건이 실패한다.
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(mockStorage.promote).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException without rollback when the post-commit re-read finds nothing', async () => {
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          insertQueryBuilder(
            jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
          ),
        );
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          insertQueryBuilder(
            jest.fn().mockRejectedValue(new Error('DB Error')),
          ),
        );
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should throw BadRequestException (FILE_TITLE_TAKEN) when the title already exists', async () => {
      // 청구되지 않은 파일명이지만, 중복 제목 사전 체크가 기존 행을 발견한다.
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      // 타입 있는 예외가 catch를 통과해 그대로 살아남고(일반 500으로 뭉개지지 않음),
      // 트랜잭션은 롤백되며, 커넥션은 반환된다.
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(mockStorage.promote).not.toHaveBeenCalled();
    });

    it('should replay instead of failing when a concurrent submit wins the unique constraint', async () => {
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          insertQueryBuilder(jest.fn().mockRejectedValue(uniqueViolation())),
        );
      // 청구 사전 체크와 제목 사전 체크 둘 다 통과한다(경합이 아직 열려 있다), 그 다음
      // 롤백 후 조회가 승자 제출이 커밋한 행을 발견한다.
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(claimedFile);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result.replayed).toBe(true);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should map a unique violation to FILE_TITLE_TAKEN when the collision is another file', async () => {
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          insertQueryBuilder(jest.fn().mockRejectedValue(uniqueViolation())),
        );
      // 이후로도 이 파일명을 청구한 행이 없으므로, 충돌은 제목 하나에서만 났다는 뜻이다.
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('updateFile', () => {
    it('should update file title successfully', async () => {
      const updateFileDto = { title: 'Updated Title' };

      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockUpdateQueryBuilder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockFileEntity, title: 'Updated Title' });

      const result = await fileService.updateFile(1, updateFileDto, owner);

      expect(result).toMatchObject({ title: 'Updated Title' });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when file is not found', async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        fileService.updateFile(1, { title: 'Test' }, owner),
      ).rejects.toThrow(NotFoundException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when requester is neither creator nor admin', async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { title: 'Test' }, stranger),
      ).rejects.toThrow(ForbiddenException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should allow an admin to update a file they do not own', async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockUpdateQueryBuilder);
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockFileEntity, title: 'By Admin' });

      const result = await fileService.updateFile(
        1,
        { title: 'By Admin' },
        admin,
      );

      expect(result).toMatchObject({ title: 'By Admin' });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    // ~459행의 사전 체크는 잠금 없는 읽기라, 같은 제목으로 경합하는 동시 PATCH가
    // unique 제약이 승자를 정하기 전에 통과할 수 있다.
    describe('title race (23505)', () => {
      const uniqueViolation = () =>
        new QueryFailedError(
          'UPDATE',
          [],
          Object.assign(new Error('duplicate key'), { code: '23505' }),
        );

      it('should translate a concurrent title race into 400 FILE_TITLE_TAKEN, not a raw 500', async () => {
        queryRunner.manager.findOne = jest
          .fn()
          .mockResolvedValue(mockFileEntity);
        // 중복 제목 사전 체크는 통과한다(경합이 아직 열려 있다).
        jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(null);

        const mockUpdateQueryBuilder = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockRejectedValue(uniqueViolation()),
        };
        queryRunner.manager.createQueryBuilder = jest
          .fn()
          .mockReturnValue(mockUpdateQueryBuilder);

        await expect(
          fileService.updateFile(1, { title: 'Racing Title' }, owner),
        ).rejects.toThrow(BadRequestException);
        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(queryRunner.release).toHaveBeenCalled();
      });

      it('should rethrow an unrelated update failure unchanged', async () => {
        queryRunner.manager.findOne = jest
          .fn()
          .mockResolvedValue(mockFileEntity);
        jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(null);

        const failure = new Error('connection lost');
        const mockUpdateQueryBuilder = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockRejectedValue(failure),
        };
        queryRunner.manager.createQueryBuilder = jest
          .fn()
          .mockReturnValue(mockUpdateQueryBuilder);

        await expect(
          fileService.updateFile(1, { title: 'X' }, owner),
        ).rejects.toThrow(failure);
        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(queryRunner.release).toHaveBeenCalled();
      });
    });

    it("should throw BadRequestException for 'temp_' file path", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { filePath: 'temp_video.mp4' }, owner),
      ).rejects.toThrow(BadRequestException);
    });

    it("should update file path with 'granted_' prefix", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.updateFile(1, { filePath: 'granted_video.mp4' }, owner);

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'granted_video.mp4' }),
      );
    });

    // ADR 0025 D1/D3: visibility 토글은 새 엔드포인트가 아니라 이 쓰기 경로를 재사용하므로,
    // 토큰 발급/회전/폐기가 모두 같은 트랜잭션 안에 있다.
    describe('visibility toggling', () => {
      const setupUpdate = (existing: FileEntity) => {
        queryRunner.manager.findOne = jest.fn().mockResolvedValue(existing);
        const mockUpdateQueryBuilder = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        queryRunner.manager.createQueryBuilder = jest
          .fn()
          .mockReturnValue(mockUpdateQueryBuilder);
        jest.spyOn(fileRepository, 'findOne').mockResolvedValue(existing);
        return mockUpdateQueryBuilder;
      };

      it('generates a share token when switching to unlisted', async () => {
        const mockUpdateQueryBuilder = setupUpdate(mockFileEntity);

        await fileService.updateFile(
          1,
          { visibility: FileVisibility.unlisted },
          owner,
        );

        const [setCall] = mockUpdateQueryBuilder.set.mock.calls as [
          { visibility?: FileVisibility; shareToken?: string },
        ][];
        expect(setCall[0].visibility).toBe(FileVisibility.unlisted);
        expect(typeof setCall[0].shareToken).toBe('string');
        expect(setCall[0].shareToken).not.toHaveLength(0);
      });

      it('rotates the share token, invalidating the previous link', async () => {
        const unlistedFile = {
          ...mockFileEntity,
          visibility: FileVisibility.unlisted,
          shareToken: 'old-token',
        };
        const mockUpdateQueryBuilder = setupUpdate(unlistedFile);

        await fileService.updateFile(1, { rotateShareToken: true }, owner);

        const [setCall] = mockUpdateQueryBuilder.set.mock.calls as [
          { shareToken?: string },
        ][];
        expect(setCall[0].shareToken).toEqual(expect.any(String));
        expect(setCall[0].shareToken).not.toBe('old-token');
      });

      it('clears the share token when leaving unlisted', async () => {
        const unlistedFile = {
          ...mockFileEntity,
          visibility: FileVisibility.unlisted,
          shareToken: 'old-token',
          shareExpiresAt: new Date('2026-01-01'),
        };
        const mockUpdateQueryBuilder = setupUpdate(unlistedFile);

        await fileService.updateFile(
          1,
          { visibility: FileVisibility.public },
          owner,
        );

        expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
          expect.objectContaining({
            visibility: FileVisibility.public,
            shareToken: null,
            shareExpiresAt: null,
          }),
        );
      });

      it('sets shareExpiresAt only when the resulting visibility is unlisted', async () => {
        const mockUpdateQueryBuilder = setupUpdate(mockFileEntity);

        await fileService.updateFile(
          1,
          {
            visibility: FileVisibility.unlisted,
            shareExpiresAt: '2026-12-31T00:00:00.000Z',
          },
          owner,
        );

        expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
          expect.objectContaining({
            shareExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
          }),
        );
      });

      it('ignores shareExpiresAt when not entering unlisted', async () => {
        const mockUpdateQueryBuilder = setupUpdate(mockFileEntity);

        await fileService.updateFile(
          1,
          { shareExpiresAt: '2026-12-31T00:00:00.000Z' },
          owner,
        );

        const [setCall] = mockUpdateQueryBuilder.set.mock.calls as [
          { shareExpiresAt?: Date | null },
        ][];
        expect(setCall[0].shareExpiresAt).toBeUndefined();
      });
    });
  });

  // ADR 0050: 옛 즉시-재배정 `userId` 필드를 propose/accept/reject/cancel 동의 흐름으로
  // 대체한다. mockFileEntity의 creator는 id 1(owner)이고, 이 테스트들은 전부 id 2를
  // 제안 대상으로 쓴다.
  describe('proposeTransfer', () => {
    const setupUpdateQueryBuilder = () => {
      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockUpdateQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );
      return mockUpdateQueryBuilder;
    };

    it('proposes a transfer and leaves ownership unchanged', async () => {
      const target = { id: 2, email: 'target@test.com' } as UserEntity;
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce({ ...mockFileEntity, pendingTransferTo: null })
        .mockResolvedValueOnce({
          ...mockFileEntity,
          pendingTransferTo: target,
        });
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(target);
      const mockUpdateQueryBuilder = setupUpdateQueryBuilder();

      const result = await fileService.proposeTransfer(1, 2, owner);

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith({
        pendingTransferTo: target,
      });
      expect(result.pendingTransferTo).toEqual({
        id: 2,
        email: 'target@test.com',
      });
    });

    it("allows an admin to propose on the creator's behalf", async () => {
      const target = { id: 2, email: 'target@test.com' } as UserEntity;
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce({ ...mockFileEntity, pendingTransferTo: null })
        .mockResolvedValueOnce({
          ...mockFileEntity,
          pendingTransferTo: target,
        });
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(target);
      setupUpdateQueryBuilder();

      await expect(
        fileService.proposeTransfer(1, 2, admin),
      ).resolves.toBeDefined();
    });

    it('throws ForbiddenException for a non-owner, non-admin requester', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(fileService.proposeTransfer(1, 2, stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when the target is the current owner', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(fileService.proposeTransfer(1, 1, owner)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when a transfer is already pending, without overwriting it', async () => {
      const existingTarget = {
        id: 3,
        email: 'existing@test.com',
      } as UserEntity;
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: existingTarget,
      });
      const mockUpdateQueryBuilder = setupUpdateQueryBuilder();

      await expect(fileService.proposeTransfer(1, 2, owner)).rejects.toThrow(
        ConflictException,
      );
      expect(mockUpdateQueryBuilder.set).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.proposeTransfer(1, 2, owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the file does not exist', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.proposeTransfer(1, 2, owner)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('acceptTransfer', () => {
    const pendingTarget = { id: 2, email: 'target@test.com' } as UserEntity;

    const setupUpdateQueryBuilder = () => {
      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockUpdateQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );
      return mockUpdateQueryBuilder;
    };

    it('moves ownership to the target and audits FILE_TRANSFER', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce({
          ...mockFileEntity,
          pendingTransferTo: pendingTarget,
        })
        .mockResolvedValueOnce({
          ...mockFileEntity,
          creator: pendingTarget,
          pendingTransferTo: null,
        });
      const mockUpdateQueryBuilder = setupUpdateQueryBuilder();

      const target = { id: 2, role: UserRole.user };
      const result = await fileService.acceptTransfer(1, target);

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith({
        creator: pendingTarget,
        pendingTransferTo: null,
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        2,
        1,
        AuditTargetType.file,
        'FILE_TRANSFER',
        'from=1 to=2',
      );
      expect(result.creator).toEqual({ id: 2, email: 'target@test.com' });
    });

    it('throws BadRequestException when nothing is pending', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(
        fileService.acceptTransfer(1, { id: 2, role: UserRole.user }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for anyone other than the pending target, admin included', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(fileService.acceptTransfer(1, admin)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });

  describe('rejectTransfer', () => {
    const pendingTarget = { id: 2, email: 'target@test.com' } as UserEntity;

    const setupUpdateQueryBuilder = () => {
      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockUpdateQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );
      return mockUpdateQueryBuilder;
    };

    it('clears the pending state and leaves ownership unchanged', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce({
          ...mockFileEntity,
          pendingTransferTo: pendingTarget,
        })
        .mockResolvedValueOnce({ ...mockFileEntity, pendingTransferTo: null });
      const mockUpdateQueryBuilder = setupUpdateQueryBuilder();

      const result = await fileService.rejectTransfer(1, {
        id: 2,
        role: UserRole.user,
      });

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith({
        pendingTransferTo: null,
      });
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
      expect(result.creator).toEqual({ id: 1, email: 'creator@test.com' });
    });

    it('throws BadRequestException when nothing is pending', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(
        fileService.rejectTransfer(1, { id: 2, role: UserRole.user }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for anyone other than the pending target, admin included', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(fileService.rejectTransfer(1, admin)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('cancelTransfer', () => {
    const pendingTarget = { id: 2, email: 'target@test.com' } as UserEntity;

    const setupUpdateQueryBuilder = () => {
      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockUpdateQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );
      return mockUpdateQueryBuilder;
    };

    it('allows the proposer (creator) to cancel a pending transfer', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce({
          ...mockFileEntity,
          pendingTransferTo: pendingTarget,
        })
        .mockResolvedValueOnce({ ...mockFileEntity, pendingTransferTo: null });
      const mockUpdateQueryBuilder = setupUpdateQueryBuilder();

      await fileService.cancelTransfer(1, owner);

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith({
        pendingTransferTo: null,
      });
    });

    it('throws ForbiddenException for an admin who is not the proposer (cancel is creator-only, unlike propose)', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(fileService.cancelTransfer(1, admin)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for a non-owner, non-admin requester', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(fileService.cancelTransfer(1, stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when nothing is pending', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(fileService.cancelTransfer(1, owner)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getFiles', () => {
    // 순수 `GET /file`에 대해 전역 pipe가 컨트롤러에 넘길 DTO 인스턴스.
    const listQuery = (overrides: Partial<GetFilesDto> = {}): GetFilesDto => ({
      take: 20,
      skip: 0,
      sortBy: 'createdAt',
      order: 'DESC',
      ...overrides,
    });

    let listQueryBuilder: Record<string, jest.Mock>;

    beforeEach(() => {
      listQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockFileEntity], 1]),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          listQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );
    });

    // 아래의 일반 동작 테스트는 전부 admin으로 실행한다 — 그래야 visibility 필터
    // (더 아래 전용 블록에서 다룬다)가 추가 andWhere 호출을 붙이지 않아, 이 무관한
    // 검증들이 그걸 신경 쓸 필요가 없다.
    it('should apply take and skip to the query', async () => {
      const [files, count] = await fileService.getFiles(listQuery(), admin);

      expect(listQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'file.creator',
        'creator',
      );
      expect(listQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(listQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(count).toBe(1);
      expect(files[0]).toMatchObject({ id: 1, title: 'Test File' });
    });

    it('should default to newest first with id as a tiebreaker', async () => {
      await fileService.getFiles(listQuery(), admin);

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith(
        'file.createdAt',
        'DESC',
      );
      // 고유한 tiebreaker가 없으면 createdAt이 같은 행들이 페이지 사이에서 중복되거나
      // 누락될 수 있다(동률일 때 offset 순서는 미정의다).
      expect(listQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'file.id',
        'DESC',
      );
    });

    it('should map an allowed sort key to its column instead of interpolating it', async () => {
      await fileService.getFiles(
        listQuery({ sortBy: 'title', order: 'ASC' }),
        admin,
      );

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith(
        'file.title',
        'ASC',
      );
      expect(listQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'file.id',
        'ASC',
      );
    });

    it('should not duplicate the tiebreaker when sorting by id', async () => {
      await fileService.getFiles(listQuery({ sortBy: 'id' }), admin);

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith('file.id', 'DESC');
      expect(listQueryBuilder.addOrderBy).not.toHaveBeenCalled();
    });

    it('should search the title with a case-insensitive partial match', async () => {
      await fileService.getFiles(listQuery({ search: 'holiday' }), admin);

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        "file.title ILIKE :term ESCAPE '\\'",
        { term: '%holiday%' },
      );
    });

    it('should escape LIKE wildcards so they match literally', async () => {
      await fileService.getFiles(listQuery({ search: '100%_a\\b' }), admin);

      // 이스케이프하지 않으면 `%`와 `_`가 실제 입력보다 훨씬 넓게 매칭돼 버린다.
      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        "file.title ILIKE :term ESCAPE '\\'",
        { term: '%100\\%\\_a\\\\b%' },
      );
    });

    it('should ignore a whitespace-only search term', async () => {
      await fileService.getFiles(listQuery({ search: '   ' }), admin);

      expect(listQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should filter by creator through the existing join', async () => {
      await fileService.getFiles(listQuery({ creatorId: 7 }), admin);

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        'creator.id = :creatorId',
        { creatorId: 7 },
      );
      // creator는 한 번만 join된다 — 행마다 별도 조회하지 않는다(N+1 방지).
      expect(listQueryBuilder.leftJoinAndSelect).toHaveBeenCalledTimes(1);
    });

    it('should combine search and creator filter', async () => {
      await fileService.getFiles(
        listQuery({ search: 'trip', creatorId: 3 }),
        admin,
      );

      expect(listQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    // ADR 0025: private/unlisted 메타데이터는 소유자·admin이 아닌 사람에게 새면 안 된다 —
    // 'unlisted'도 목록에서 숨긴다, "목록에 없음"이 원래 취지 자체이므로.
    it('should hide private/unlisted files from a non-admin who does not own them', async () => {
      await fileService.getFiles(listQuery(), stranger);

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(file.visibility = :publicVisibility OR creator.id = :requesterId)',
        { publicVisibility: FileVisibility.public, requesterId: stranger.id },
      );
    });

    it('should not filter by visibility for an admin', async () => {
      await fileService.getFiles(listQuery(), admin);

      expect(listQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('file.visibility'),
        expect.anything(),
      );
    });
  });

  // ADR 0025: getFileById는 요청자가 볼 수 없는 파일에 대해 403이 아니라 404로 답한다 —
  // 소유자가 아니면 private/unlisted 파일이 존재한다는 사실조차 확인할 수 없다.
  describe('getFileById', () => {
    it('returns a public file to anyone', async () => {
      const getOne = jest.fn().mockResolvedValue(mockFileEntity);
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne,
      } as unknown as SelectQueryBuilder<FileEntity>);

      const result = await fileService.getFileById(1, stranger);

      expect(result).toMatchObject({ id: 1, title: 'Test File' });
    });

    it('returns a private file to its owner', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(privateFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, owner)).resolves.toMatchObject({
        id: 1,
      });
    });

    it('returns a private file to an admin', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(privateFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, admin)).resolves.toMatchObject({
        id: 1,
      });
    });

    it('hides a private file from a stranger behind 404, not 403', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(privateFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, stranger)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a private file to its pending transfer target (ADR 0050)', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
        pendingTransferTo: { id: 2, email: 'stranger@test.com' } as UserEntity,
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(privateFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, stranger)).resolves.toMatchObject(
        {
          id: 1,
          pendingTransferTo: { id: 2, email: 'stranger@test.com' },
        },
      );
    });

    it('still hides a private file from a stranger who is not the pending target', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
        pendingTransferTo: {
          id: 99,
          email: 'someone-else@test.com',
        } as UserEntity,
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(privateFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, stranger)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hides an unlisted file from a stranger', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'token',
      };
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(unlistedFile),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, stranger)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the file does not exist', async () => {
      jest.spyOn(fileRepository, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      } as unknown as SelectQueryBuilder<FileEntity>);

      await expect(fileService.getFileById(1, stranger)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteFile', () => {
    beforeEach(() => {
      mockStorage.unlink.mockResolvedValue({ deleted: 1, failures: [] });
      // 기본값: 이 테스트의 findOne mock이 돌려준 행이 실제로 삭제되는 행이다.
      // 개별 테스트가 필요에 따라 이를 재정의한다(23503 거부, affected: 0 등).
      jest
        .spyOn(fileRepository, 'delete')
        .mockResolvedValue({ raw: [], affected: 1 });
    });

    it('should delete a file owned by the requester and audit FILE_DELETE', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      const result = await fileService.deleteFile(1, owner);

      expect(fileRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['creator'],
      });
      expect(fileRepository.delete).toHaveBeenCalledWith(1);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        owner.id,
        1,
        AuditTargetType.file,
        'FILE_DELETE',
      );
      expect(result).toBe('File 1 deleted.');
    });

    it('should unlink the stored file after the row is gone', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.deleteFile(1, owner);

      expect(mockStorage.unlink).toHaveBeenCalledTimes(1);
      expect(mockStorage.unlink).toHaveBeenCalledWith([
        'file/upload/granted_test.mp4',
      ]);
    });

    it('should still report success when the stored file cannot be unlinked', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);
      mockStorage.unlink.mockResolvedValue({
        deleted: 0,
        failures: [{ key: 'file/upload/granted_test.mp4', reason: 'ENOENT' }],
      });

      // 행은 이미 사라졌다; unlink 실패는 에러 경로가 아니라 고아를 남길 뿐이다
      // (포트는 절대 reject하지 않는다 — 실패는 보고될 뿐 던져지지 않는다).
      await expect(fileService.deleteFile(1, owner)).resolves.toBe(
        'File 1 deleted.',
      );
      expect(mockAuditLogService.log).toHaveBeenCalled();
    });

    it('should allow an admin to delete a file they do not own', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      const result = await fileService.deleteFile(1, admin);

      expect(fileRepository.delete).toHaveBeenCalledWith(1);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        admin.id,
        1,
        AuditTargetType.file,
        'FILE_DELETE',
      );
      expect(result).toBe('File 1 deleted.');
    });

    it('should throw NotFoundException when file is not found', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.deleteFile(1, owner)).rejects.toThrow(
        NotFoundException,
      );
      expect(fileRepository.delete).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when requester is neither creator nor admin', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await expect(fileService.deleteFile(1, stranger)).rejects.toThrow(
        ForbiddenException,
      );
      expect(fileRepository.delete).not.toHaveBeenCalled();
    });

    it('should translate a post reference (23503) into a 409 instead of a 500', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);
      jest.spyOn(fileRepository, 'delete').mockRejectedValue(
        new QueryFailedError(
          'DELETE',
          [],
          Object.assign(new Error('violates foreign key constraint'), {
            code: '23503',
          }),
        ),
      );

      // 사전 조회 쿼리는 설계상 존재하지 않는다(모듈 순환 + 경합) — FK가 최종 권위이고,
      // 그 위반은 서버 결함이 아니라 클라이언트 측 결과다(ADR 0023 D4).
      await expect(fileService.deleteFile(1, owner)).rejects.toThrow(
        ConflictException,
      );
      // 행이 살아남았으므로, 그 저장 파일은 unlink되면 안 된다.
      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException and skip unlink/audit when a concurrent delete already removed the row', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);
      jest
        .spyOn(fileRepository, 'delete')
        .mockResolvedValue({ raw: [], affected: 0 });

      // affected: 0은 이 요청의 findOne 읽기와 delete 호출 사이에 다른 요청이 행을
      // 지웠다는 뜻이다 — 이미 사라진 행에 unlink/감사 로그를 또 실행하는 대신
      // "찾을 수 없음"과 동일하게 보고한다.
      await expect(fileService.deleteFile(1, owner)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });

  // PostService가 파일을 첨부하기 전에 물어보는 것: 소유권 판정은 파일 상태를 소유한
  // 계층의 몫이지, file.creator를 직접 들여다보는 reach-through가 아니다(ADR 0023 D1).
  describe('assertAttachableBy', () => {
    it('passes for the file creator', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await expect(
        fileService.assertAttachableBy(1, owner.id),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException for a missing file', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.assertAttachableBy(1, owner.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an admin attaching a file they did not create', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      // canManage과 달리 의도적으로 신원만 본다: "게시글은 오직 자기 작성자의 파일만
      // 참조한다"는 규칙이 계정 연쇄 삭제를 FK 안전하게 만든다.
      await expect(fileService.assertAttachableBy(1, admin.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // 계정 삭제 연쇄(ADR 0020): UserService가 트랜잭션을 소유하고 자신의 EntityManager를
  // 넘겨주지만, 파일 행은 여전히 FileService를 거친다.
  describe('creator cascade helpers', () => {
    const mockDeleteBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const mockManager = {
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockDeleteBuilder),
    };

    it('findStoredPathsOfCreator returns only the stored paths, deleting nothing', async () => {
      mockManager.find.mockResolvedValue([
        { filePath: 'file/upload/granted_a.mp4' },
        { filePath: 'file/upload/granted_b.mp4' },
      ]);

      const paths = await fileService.findStoredPathsOfCreator(
        mockManager as unknown as EntityManager,
        7,
      );

      expect(mockManager.find).toHaveBeenCalledWith(FileEntity, {
        where: { creator: { id: 7 } },
      });
      expect(mockManager.createQueryBuilder).not.toHaveBeenCalled();
      expect(paths).toEqual([
        'file/upload/granted_a.mp4',
        'file/upload/granted_b.mp4',
      ]);
    });

    it('deleteFilesOfCreator deletes by creatorId, not by a stale id list', async () => {
      await fileService.deleteFilesOfCreator(
        mockManager as unknown as EntityManager,
        7,
      );

      expect(mockDeleteBuilder.from).toHaveBeenCalledWith(FileEntity);
      expect(mockDeleteBuilder.where).toHaveBeenCalledWith(
        '"creatorId" = :creatorId',
        { creatorId: 7 },
      );
      expect(mockDeleteBuilder.execute).toHaveBeenCalled();
    });

    it('deleteFilesOfCreator translates a stranger post reference (23503) into a 409', async () => {
      mockDeleteBuilder.execute.mockRejectedValueOnce(
        new QueryFailedError(
          'DELETE',
          [],
          Object.assign(new Error('violates foreign key constraint'), {
            code: '23503',
          }),
        ),
      );

      // 이전에 소유권이 재배정된 뒤에만 도달 가능하지만, 그래도 도달 가능하다 — 그래서
      // 연쇄 삭제는 정체불명 500이 아니라 반드시 409 USER_FILES_IN_USE로 답해야 한다(ADR 0024).
      await expect(
        fileService.deleteFilesOfCreator(
          mockManager as unknown as EntityManager,
          7,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('deleteFilesOfCreator rethrows a non-FK failure untouched', async () => {
      const failure = new Error('connection lost');
      mockDeleteBuilder.execute.mockRejectedValueOnce(failure);

      // 예측 가능한, 클라이언트가 도달할 수 있는 결과만 타입을 붙인다; 진짜 서버 결함은
      // 충돌로 위장하지 않고 500으로 남아야 한다.
      await expect(
        fileService.deleteFilesOfCreator(
          mockManager as unknown as EntityManager,
          7,
        ),
      ).rejects.toThrow(failure);
    });
  });

  // GET /file/:id/content의 접근 매트릭스(ADR 0025 D1/D2/D3/D6): 이제 모든 granted 읽기가
  // 이 판정을 거친다 — file/upload가 더 이상 정적으로 서빙되지 않으므로.
  describe('resolveContentAccess', () => {
    it('serves a public file to an anonymous requester', async () => {
      const publicFile = {
        ...mockFileEntity,
        visibility: FileVisibility.public,
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(publicFile);

      await expect(fileService.resolveContentAccess(1, null)).resolves.toBe(
        publicFile,
      );
    });

    it('serves a private file to its owner', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(privateFile);

      await expect(fileService.resolveContentAccess(1, owner)).resolves.toBe(
        privateFile,
      );
    });

    it('serves a private file to an admin', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(privateFile);

      await expect(fileService.resolveContentAccess(1, admin)).resolves.toBe(
        privateFile,
      );
    });

    it('refuses a private file to a stranger with FORBIDDEN_NOT_OWNER', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(privateFile);

      await expect(
        fileService.resolveContentAccess(1, stranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a private file to an anonymous requester', async () => {
      const privateFile = {
        ...mockFileEntity,
        visibility: FileVisibility.private,
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(privateFile);

      await expect(fileService.resolveContentAccess(1, null)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('serves an unlisted file to its owner without a share token', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'the-token',
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      await expect(fileService.resolveContentAccess(1, owner)).resolves.toBe(
        unlistedFile,
      );
    });

    it('serves an unlisted file to an anonymous requester with a matching share token', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'the-token',
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      await expect(
        fileService.resolveContentAccess(1, null, 'the-token'),
      ).resolves.toBe(unlistedFile);
    });

    it('refuses an unlisted file with no share token', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'the-token',
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      await expect(fileService.resolveContentAccess(1, null)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses an unlisted file after its token was rotated', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'new-token',
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      // 회전 전에 받아둔 옛 링크는 즉시 동작을 멈춰야 한다.
      await expect(
        fileService.resolveContentAccess(1, null, 'old-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses an unlisted file whose share token has expired', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'the-token',
        shareExpiresAt: new Date(Date.now() - 1000),
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      await expect(
        fileService.resolveContentAccess(1, null, 'the-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('serves an unlisted file with a valid token before expiry', async () => {
      const unlistedFile = {
        ...mockFileEntity,
        visibility: FileVisibility.unlisted,
        shareToken: 'the-token',
        shareExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(unlistedFile);

      await expect(
        fileService.resolveContentAccess(1, null, 'the-token'),
      ).resolves.toBe(unlistedFile);
    });

    it('throws NotFoundException when the file does not exist', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.resolveContentAccess(1, null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
