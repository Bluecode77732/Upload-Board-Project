import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  Repository,
  QueryRunner,
  SelectQueryBuilder,
} from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { UserEntity } from 'backend/user/entity/user.entity';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('FileService', () => {
  let fileService: FileService;
  let fileRepository: Repository<FileEntity>;
  let userRepository: Repository<UserEntity>;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

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
      filePath: 'temp_video.mp4',
    };

    it('should successfully upload a file', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      };

      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockInsertQueryBuilder);
      (fs.rename as jest.Mock).mockResolvedValue(undefined);
      // First findOne is the duplicate-title pre-check (no match); second is the post-commit re-read.
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockFileEntity);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result).toMatchObject({
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

    it('should throw NotFoundException without rollback when the post-commit re-read finds nothing', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      };

      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockInsertQueryBuilder);
      (fs.rename as jest.Mock).mockResolvedValue(undefined);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('DB Error')),
      };

      queryRunner.manager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockInsertQueryBuilder);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should throw BadRequestException (FILE_TITLE_TAKEN) when the title already exists', async () => {
      // Duplicate-title pre-check finds an existing row.
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(
        BadRequestException,
      );
      // The typed exception survives the catch (not collapsed to a generic 500),
      // the transaction rolls back, and the connection is released.
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
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

      const result = await fileService.updateFile(1, updateFileDto, 1);

      expect(result).toMatchObject({ title: 'Updated Title' });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when file is not found', async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        fileService.updateFile(1, { title: 'Test' }, 1),
      ).rejects.toThrow(NotFoundException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when requester is not the creator', async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { title: 'Test' }, 2),
      ).rejects.toThrow(ForbiddenException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it("should throw BadRequestException for 'temp_' file path", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { filePath: 'temp_video.mp4' }, 1),
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

      await fileService.updateFile(1, { filePath: 'granted_video.mp4' }, 1);

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

      await fileService.updateFile(1, { userId: 1 }, 1);

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
    it('should delete a file owned by the requester', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      const result = await fileService.deleteFile(1, 1);

      expect(fileRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['creator'],
      });
      expect(fileRepository.delete).toHaveBeenCalledWith(1);
      expect(result).toBe('File 1 deleted.');
    });

    it('should throw NotFoundException when file is not found', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(fileService.deleteFile(1, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(fileRepository.delete).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when requester is not the creator', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await expect(fileService.deleteFile(1, 2)).rejects.toThrow(
        ForbiddenException,
      );
      expect(fileRepository.delete).not.toHaveBeenCalled();
    });
  });
});
