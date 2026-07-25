import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import * as bcrypt from 'bcrypt';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';

jest.mock('bcrypt');

describe('UserService', () => {
  let userService: UserService;

  const mockUserRepository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  // transaction(level, cb) runs the callback with a mocked EntityManager.
  const mockManager = {
    findOne: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const mockDataSource = {
    transaction: jest.fn(
      (_level: unknown, cb: (m: typeof mockManager) => unknown) =>
        cb(mockManager),
    ),
  };

  const mockAuditLogService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('update', () => {
    it('should update a user.', async () => {
      const updateUserDto: UpdateUserDto = {
        email: 'email@gmail.com',
        password: 'PrivatePassword',
      };

      const genSalt = 10;
      const userId = 1;
      const hashed = 'hashed_password';

      const user = { id: userId, email: 'email@gmail.com', password: hashed };

      jest
        .spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, password: hashed });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashed);
      jest.spyOn(mockUserRepository, 'update').mockResolvedValue(undefined);

      const originalPassword = updateUserDto.password;
      const result = await userService.update(userId, updateUserDto);

      expect(result).toEqual({ ...user, password: hashed });
      expect(bcrypt.hash).toHaveBeenCalledWith(originalPassword, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: userId },
        { email: updateUserDto.email, password: hashed },
      );
    });

    it("should throw NotFoundException when the user doesn't exist.", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(userService.update(1, { email: 'x@y.com' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('should change role, clear the session, and audit after commit', async () => {
      mockManager.findOne.mockResolvedValue({ id: 2, role: UserRole.user });
      mockManager.update.mockResolvedValue(undefined);

      const result = await userService.updateRole(1, 2, UserRole.admin);

      expect(mockManager.update).toHaveBeenCalledWith(UserEntity, 2, {
        role: UserRole.admin,
        refreshTokenHash: null,
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        'ROLE_CHANGE',
        'user→admin',
      );
      expect(result).toEqual({ id: 2, role: UserRole.admin });
    });

    it('should throw NotFoundException when the target is missing', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        userService.updateRole(1, 99, UserRole.admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should refuse to demote the last superadmin', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        role: UserRole.superadmin,
      });
      mockManager.count.mockResolvedValue(1);

      await expect(
        userService.updateRole(1, 2, UserRole.admin),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should allow demoting a superadmin when another remains', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        role: UserRole.superadmin,
      });
      mockManager.count.mockResolvedValue(2);
      mockManager.update.mockResolvedValue(undefined);

      await userService.updateRole(1, 2, UserRole.admin);

      expect(mockManager.update).toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        'ROLE_CHANGE',
        'superadmin→admin',
      );
    });
  });

  describe('remove', () => {
    it('should delete a user and audit USER_DELETE', async () => {
      jest
        .spyOn(mockUserRepository, 'findOne')
        .mockResolvedValue({ id: 2, email: 'a@b.com' });
      jest.spyOn(mockUserRepository, 'delete').mockResolvedValue(undefined);

      const result = await userService.remove(1, 2);

      expect(mockUserRepository.delete).toHaveBeenCalledWith(2);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(1, 2, 'USER_DELETE');
      expect(result).toBe('User 2 deleted.');
    });

    it('should throw NotFoundException when the user is missing', async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(userService.remove(1, 2)).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.delete).not.toHaveBeenCalled();
    });
  });
});
