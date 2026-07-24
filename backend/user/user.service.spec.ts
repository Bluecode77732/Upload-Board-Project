import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import * as bcrypt from 'bcrypt';
import { NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
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
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(originalPassword, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: userId },
        { email: updateUserDto.email, password: hashed },
      );
    });

    it("should throw NotFoundException when the user doesn't exist.", async () => {
      const updateUserDto: UpdateUserDto = {
        email: 'email@gmail.com',
        password: 'PrivatePassword',
      };

      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(userService.update(1, updateUserDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });
});
