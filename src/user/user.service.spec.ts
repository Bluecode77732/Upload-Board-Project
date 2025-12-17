import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';


describe('UserService', () => {
  let userService: UserService;
  let configService: ConfigService;

  const mockUserRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
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
    configService = module.get<ConfigService>(ConfigService);
  });

  // Clears the mock.calls and mock.instances properties of all mocks.
  afterEach(() => {
    jest.clearAllMocks();
  });


  describe("create", () => {
    it('should create a new user.', async () => {
      const createUserDto: CreateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      const genSalt = 10;
      const userId = 1;
      const email = "email@gamil.com";
      const hashed = genSalt;

      const result = {
        id: userId,
        email: email,
        password: hashed,
      };

      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashed));
      // Inserting `null` does explicitly include the 'failed search'.
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValueOnce(null).mockResolvedValueOnce(result);

      const newUser = await userService.create(createUserDto);

      expect(newUser).toEqual(result);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { email: createUserDto.email } });
      expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, genSalt);
      expect(mockUserRepository.save).toHaveBeenCalledWith({ email: createUserDto.email, password: hashed, });
    });

    it('should throw a BadRequestException when the user already exist.', async () => {
      const createUserDto: CreateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue({ id: 1, email: createUserDto.email, });

      expect(userService.create(createUserDto)).rejects.toThrow(BadRequestException);
      expect(mockUserRepository.save).not.toHaveBeenCalledWith();
    });
  });


  describe("update", () => {
    it('should update a new user.', async () => {
      const updateUserDto: UpdateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      const genSalt = 10;
      const userId = 1;
      const email = "email@gamil.com";
      const hashed = genSalt;

      const user = {
        id: userId,
        email: email,
        password: hashed,
      };

      jest.spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, password: hashed });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashed));
      jest.spyOn(mockUserRepository, 'update').mockImplementation(() => Promise.resolve(user));

      const updatedUser = await userService.update(userId, updateUserDto);

      expect(updatedUser).toEqual({ ...user, password: hashed });
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 }, });
      expect(bcrypt.hash).toHaveBeenCalledWith(updateUserDto.password, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        {
          email: updateUserDto.email,
          password: hashed,
        },
      );
    });

    it("should throw a NotFoundException when the user doesn't exist.", async () => {
      const updateUserDto: UpdateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      expect(userService.update(1, updateUserDto)).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });
});
