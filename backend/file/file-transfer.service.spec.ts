// 목적: FileTransferService(소유권 이전: 제안·수락·거절·취소)의 단위 테스트.
// 사용처: pnpm test가 실행한다.
// 근거: 이전 4개 메서드가 FileService에서 FileTransferService로 옮겨 가면서(ADR 0067) 테스트도 따라왔다.
//       응답 단언(pendingTransferTo 노출 등)이 그대로 유효하도록 mock이 아닌 실제 FileService를 쓴다.

import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { FileTransferService } from './file-transfer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { FileVisibility } from './entity/file-visibility.enum';
import { FileMediaType } from './entity/file-media-type.enum';
import { UserEntity } from 'backend/user/entity/user.entity';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

describe('FileTransferService', () => {
  let fileTransferService: FileTransferService;
  let fileRepository: Repository<FileEntity>;
  let userRepository: Repository<UserEntity>;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        FileTransferService,
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
        {
          provide: getRepositoryToken(FileEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: { findOne: jest.fn() },
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: FILE_STORAGE, useValue: mockStorage },
        {
          provide: MetricsService,
          useValue: { uploadClaimsTotal: { inc: jest.fn() } },
        },
      ],
    }).compile();

    fileTransferService = module.get<FileTransferService>(FileTransferService);
    fileRepository = module.get<Repository<FileEntity>>(
      getRepositoryToken(FileEntity),
    );
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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

      const result = await fileTransferService.proposeTransfer(1, 2, owner);

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
        fileTransferService.proposeTransfer(1, 2, admin),
      ).resolves.toBeDefined();
    });

    it('throws ForbiddenException for a non-owner, non-admin requester', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(
        fileTransferService.proposeTransfer(1, 2, stranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the target is the current owner', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(
        fileTransferService.proposeTransfer(1, 1, owner),
      ).rejects.toThrow(BadRequestException);
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

      await expect(
        fileTransferService.proposeTransfer(1, 2, owner),
      ).rejects.toThrow(ConflictException);
      expect(mockUpdateQueryBuilder.set).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(
        fileTransferService.proposeTransfer(1, 2, owner),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the file does not exist', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(null);

      await expect(
        fileTransferService.proposeTransfer(1, 2, owner),
      ).rejects.toThrow(NotFoundException);
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
      const result = await fileTransferService.acceptTransfer(1, target);

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
        fileTransferService.acceptTransfer(1, { id: 2, role: UserRole.user }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for anyone other than the pending target, admin included', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(
        fileTransferService.acceptTransfer(1, admin),
      ).rejects.toThrow(ForbiddenException);
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

      const result = await fileTransferService.rejectTransfer(1, {
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
        fileTransferService.rejectTransfer(1, { id: 2, role: UserRole.user }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for anyone other than the pending target, admin included', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(
        fileTransferService.rejectTransfer(1, admin),
      ).rejects.toThrow(ForbiddenException);
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

      await fileTransferService.cancelTransfer(1, owner);

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith({
        pendingTransferTo: null,
      });
    });

    it('throws ForbiddenException for an admin who is not the proposer (cancel is creator-only, unlike propose)', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(
        fileTransferService.cancelTransfer(1, admin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for a non-owner, non-admin requester', async () => {
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({
        ...mockFileEntity,
        pendingTransferTo: pendingTarget,
      });

      await expect(
        fileTransferService.cancelTransfer(1, stranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when nothing is pending', async () => {
      jest
        .spyOn(fileRepository, 'findOne')
        .mockResolvedValue({ ...mockFileEntity, pendingTransferTo: null });

      await expect(
        fileTransferService.cancelTransfer(1, owner),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
