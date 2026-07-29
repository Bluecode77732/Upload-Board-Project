import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  Repository,
  QueryRunner,
  QueryFailedError,
  SelectQueryBuilder,
} from 'typeorm';
import { FileEntity } from './entity/file.entity';
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
import * as fs from 'fs/promises';

jest.mock('fs/promises');

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

  const mockFileEntity: FileEntity = {
    id: 1,
    title: 'Test File',
    filePath: 'file/upload/granted_test.mp4',
    creator: { id: 1, email: 'creator@test.com' } as UserEntity,
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
      // fs/promises is automocked; make the temp-file existence check pass by default
      // (mock implementations survive clearAllMocks, so it is set per test run).
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.rename as jest.Mock).mockResolvedValue(undefined);
    });

    it('should successfully upload a file', async () => {
      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          insertQueryBuilder(
            jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
          ),
        );
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
        fileUrl: 'http://localhost:3000/file/upload/granted_test.mp4',
      });
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should replay the existing file when the same user resubmits a claimed filename', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(claimedFile);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result.replayed).toBe(true);
      expect(result.file).toMatchObject({ id: 1, title: 'Test File' });
      // A retry of an already-succeeded request opens no transaction and moves no file.
      expect(queryRunner.connect).not.toHaveBeenCalled();
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (FILE_ALREADY_CLAIMED) when another user claimed the filename', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(claimedFile);

      await expect(fileService.uploadFile(uploadFileDto, 2)).rejects.toThrow(
        ConflictException,
      );
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException (FILE_INVALID_PATH) when the temp file no longer exists', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValueOnce(null);
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      // Nothing was written: the precondition fails before the transaction opens.
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
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
      expect(fs.rename).not.toHaveBeenCalled();
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
  });

  describe('getFiles', () => {
    it('should apply take and skip to the query', async () => {
      const mockListQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockFileEntity], 1]),
      };
      jest
        .spyOn(fileRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockListQueryBuilder as unknown as SelectQueryBuilder<FileEntity>,
        );

      const [files, count] = await fileService.getFiles(20, 0);

      expect(mockListQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'file.creator',
        'creator',
      );
      expect(mockListQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(mockListQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(count).toBe(1);
      expect(files[0]).toMatchObject({ id: 1, title: 'Test File' });
    });
  });

  describe('deleteFile', () => {
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
  });
});
