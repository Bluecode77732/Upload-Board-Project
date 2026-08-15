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
import {
  FILE_STORAGE,
  FileStorage,
} from 'backend/storage/file-storage.interface';

// mockFileEntity.creator.id === 1, so `owner` manages by ownership; `stranger`
// (non-creator, plain user) is forbidden; `admin` manages by role (RBAC).
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

  const mockUser: UserEntity = {
    id: 1,
    email: 'test@example.com',
  } as any as UserEntity;

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
    // The row a first, successful claim of that filename leaves behind.
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

    // Postgres unique_violation as TypeORM surfaces it (driverError.code).
    const uniqueViolation = () =>
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

    beforeEach(() => {
      // Make the temp-object existence check pass by default (mock implementations
      // survive clearAllMocks, so it is set per test run).
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
      // findOne order: claim pre-check (unclaimed), duplicate-title pre-check, post-commit re-read.
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
        // The post-commit re-read must load the creator relation so a freshly
        // promoted file's response shape matches updateFile's.
        creator: { id: 1, email: 'creator@test.com' },
      });
      expect(fileRepository.findOne).toHaveBeenNthCalledWith(3, {
        where: { id: 1 },
        relations: ['creator'],
      });
      // The insert derives mediaType from the .mp4 extension in uploadFileDto.filePath
      // itself, never from a client-supplied field (ADR 0040 D2).
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

    it('should replay the existing file when the same user resubmits a claimed filename', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(claimedFile);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result.replayed).toBe(true);
      expect(result.file).toMatchObject({ id: 1, title: 'Test File' });
      // A retry of an already-succeeded request opens no transaction and moves no file.
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
      // Nothing was written: the precondition fails before the transaction opens.
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
      // Unclaimed filename, but the duplicate-title pre-check finds an existing row.
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      // The typed exception survives the catch (not collapsed to a generic 500),
      // the transaction rolls back, and the connection is released.
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
      // Claim pre-check and title pre-check both pass (the race is still open), then the
      // post-rollback lookup finds the row the winning submit committed.
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
      // No row claims this filename afterwards, so the collision was on the title alone.
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

    // The precheck at line ~459 is an unlocked read, so a concurrent PATCH racing on
    // the same title can pass it before the unique constraint decides a winner.
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
        // Duplicate-title precheck passes (the race is still open).
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

    it("should update creator when 'userId' provided", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

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

      await fileService.updateFile(1, { userId: 1 }, owner);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    // ADR 0025 D1/D3: visibility toggling reuses this write path rather than a new
    // endpoint, so token issuance/rotation/clearing all live inside the same tx.
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

  describe('getFiles', () => {
    // The DTO instance the global pipe would hand the controller for a bare `GET /file`.
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

    // Every generic behavior test below runs as admin so the visibility filter
    // (its own dedicated block further down) never adds an extra andWhere call
    // that these unrelated assertions would have to account for.
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
      // Without a unique tiebreaker, rows tying on createdAt could repeat or vanish
      // across pages (offset order is undefined for ties).
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

      // Unescaped, `%` and `_` would widen the match far beyond what was typed.
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
      // The creator is joined once, not queried per row (N+1).
      expect(listQueryBuilder.leftJoinAndSelect).toHaveBeenCalledTimes(1);
    });

    it('should combine search and creator filter', async () => {
      await fileService.getFiles(
        listQuery({ search: 'trip', creatorId: 3 }),
        admin,
      );

      expect(listQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    // ADR 0025: private/unlisted metadata must not leak to a non-owner/non-admin —
    // 'unlisted' hides from listings too since the whole point is "not listed".
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

  // ADR 0025: getFileById answers 404 (not 403) for a file the requester cannot see,
  // so a non-owner cannot even confirm a private/unlisted file exists.
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
      // Default: the row this test's findOne mock returned is the one actually deleted.
      // Individual tests override this (23503 rejection, affected: 0) as needed.
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

      // The row is already gone; a failed unlink leaves an orphan, not an error path
      // (the port never rejects — failures are reported, not thrown).
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

      // No pre-check query exists by design (module cycle + race) — the FK is the
      // authority, and its violation is a client outcome, not a server fault (ADR 0023 D4).
      await expect(fileService.deleteFile(1, owner)).rejects.toThrow(
        ConflictException,
      );
      // The row survived, so its stored file must not be unlinked.
      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException and skip unlink/audit when a concurrent delete already removed the row', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);
      jest
        .spyOn(fileRepository, 'delete')
        .mockResolvedValue({ raw: [], affected: 0 });

      // affected: 0 means another request deleted the row between this request's
      // findOne read and its delete call — report it the same as "not found" rather
      // than running unlink/audit a second time for a row that is already gone.
      await expect(fileService.deleteFile(1, owner)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });

  // Asked by PostService before it attaches a file: the ownership decision belongs to
  // the layer that owns file state, never to a reach-through on file.creator (ADR 0023 D1).
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

      // Identity-only on purpose, unlike canManage: "a post references only its own
      // author's file" is what makes the account cascade FK-safe.
      await expect(fileService.assertAttachableBy(1, admin.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // The account-deletion cascade (ADR 0020): UserService owns the transaction and
  // passes its EntityManager in, so file rows still go through FileService.
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

      // Reachable only after a prior ownership reassignment, but reachable — so the
      // cascade must answer 409 USER_FILES_IN_USE, never the opaque 500 (ADR 0024).
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

      // Only the foreseeable client-reachable outcome is typed; a genuine server
      // fault must stay a 500 rather than be disguised as a conflict.
      await expect(
        fileService.deleteFilesOfCreator(
          mockManager as unknown as EntityManager,
          7,
        ),
      ).rejects.toThrow(failure);
    });
  });

  // GET /file/:id/content's access matrix (ADR 0025 D1/D2/D3/D6): every granted read
  // now goes through this judgment, since file/upload is no longer statically served.
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

      // The old link, captured before rotation, must stop working immediately.
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
