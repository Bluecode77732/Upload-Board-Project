import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { UserEntity } from 'src/user/entity/user.entity';
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

describe('FileService', () => {
  // Using let will inherit mock instances when the mock gets cleared.
  let fileService: FileService;
  let fileRepository: Repository<FileEntity>;
  let userRepository: Repository<UserEntity>;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  // Mock data
  const mockFileEntity: FileEntity = {
    id: 1,
    title: 'Test File',
    filePath: 'file/upload/granted_test.mp4',
    creator: { id: 1, username: 'testuser' } as any as UserEntity,  // `as any as UserEntity` for type safety
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FileEntity;

  const mockUser: UserEntity = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
  } as any as UserEntity;

  beforeEach(async () => {
    // Mock QueryRunner
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

    // Mock DataSource
    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    // Mock Repository methods
    const mockFileRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(FileEntity),
          useValue: mockFileRepository,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    fileService = module.get<FileService>(FileService);
    fileRepository = module.get<Repository<FileEntity>>(getRepositoryToken(FileEntity));
    userRepository = module.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    dataSource = module.get<DataSource>(DataSource);
    queryRunner = dataSource.createQueryRunner();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });


  describe('uploadFile', () => {
    const uploadFileDto = {
      title: 'New Video',
      userId: 1,
      filePath: 'temp_video.mp4',
    };

    it('should successfully upload a file', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockInsertQueryBuilder);
      (fs.rename as jest.Mock) = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result).toEqual(mockFileEntity);
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('DB Error')),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockInsertQueryBuilder);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(InternalServerErrorException);
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

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({ ...mockFileEntity, title: 'Updated Title' });

      const result = await fileService.updateFile(1, updateFileDto);

      expect(result).toBe('Updated Title');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it("should throw 'NotFoundException' when file is not found", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(null);

      await expect(fileService.updateFile(1, { title: 'Test' })).rejects.toThrow(NotFoundException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it("should throw 'BadRequestException' for 'temp_' file path", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { filePath: 'temp_video.mp4' })
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

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.updateFile(1, { filePath: 'granted_video.mp4' });

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'granted_video.mp4' })
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

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.updateFile(
        1,
        { userId: 1 }
      );

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});