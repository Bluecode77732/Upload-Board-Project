import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: Repository<UserEntity>;
  let jwtService: JwtService;

  const mockUserEntity: UserEntity = {
    id: 1,
    email: 'test@gmail.com',
    password: 'Test123Password',
    creator: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseBasicToken', () => {
    it('should parse valid basic token', async () => {
      const token = Buffer.from('test@gmail.com:Test123Password').toString(
        'base64',
      );
      const rawToken = `Basic ${token}`;

      const result = await authService.parseBasicToken(rawToken);

      expect(result.email).toBe('test@gmail.com');
      expect(result.password).toBe('Test123Password');
    });

    it('should throw BadRequestException for invalid token format', () => {
      expect(authService.parseBasicToken('InvalidTokenFormat')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid basic token format', () => {
      expect(authService.parseBasicToken('Basic token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for bearer token passed to parseBasicToken', () => {
      expect(authService.parseBasicToken('Bearer token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('parseBearerToken', () => {
    it('should parse a valid bearer token', async () => {
      const rawToken = 'Bearer validtoken';
      const payload = { type: 'access' };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload);
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');

      const result = await authService.parseBearerToken(rawToken, false);

      expect(result).toEqual(payload);
    });

    it('should throw UnauthorizedException for invalid token format', async () => {
      await expect(
        authService.parseBearerToken('InvalidTokenFormat', false),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong scheme', async () => {
      await expect(
        authService.parseBearerToken('Basic token', false),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired/invalid token', async () => {
      await expect(
        authService.parseBearerToken('token', false),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('register', () => {
    const token = Buffer.from('test@gmail.com:Test123Password').toString(
      'base64',
    );
    const basicToken = `Basic ${token}`;
    const hashRounds = 10;
    const email = 'test@gmail.com';
    const password = 'Test123Password';
    const hashedPassword = 'HashedPassword';

    it('should register a new user', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ email, password: hashedPassword });
      mockUserRepository.save.mockResolvedValueOnce({
        email,
        password: hashedPassword,
      });
      mockConfigService.getOrThrow.mockReturnValue(hashRounds);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

      const result = await authService.register(basicToken);

      expect(bcrypt.hash).toHaveBeenCalledWith(password, hashRounds);
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(result).toEqual({ email, password: hashedPassword });
    });

    it('should throw BadRequestException when user already exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUserEntity);

      await expect(authService.register(basicToken)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    const email = 'test@gmail.com';
    const password = '#Test@123$Password!';
    const user = { email, password: 'Hashed@123!Password' };

    it('should validate user', async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.validateUser(email, password);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email } });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        password,
        'Hashed@123!Password',
      );
      expect(result).toEqual(user);
    });

    it('should throw BadRequestException for non-existent user', async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(authService.validateUser(email, password)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when password is incorrect', async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.validateUser(email, password)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('issueToken', () => {
    const user = { id: 1 };
    const token = 'token';

    beforeEach(() => {
      jest
        .spyOn(mockConfigService, 'getOrThrow')
        .mockImplementation((key: string) => {
          const map: Record<string, string | number> = {
            REFRESH_TOKEN_SECRET: 'refresh_secret',
            ACCESS_TOKEN_SECRET: 'access_secret',
            REFRESH_TOKEN_SECRET_EXPIRES_IN: 3600,
            ACCESS_TOKEN_SECRET_EXPIRES_IN: 900,
          };
          return map[key];
        });
      jest.spyOn(jwtService, 'signAsync').mockResolvedValue(token);
    });

    it('should issue a refresh token', async () => {
      const result = await authService.issueToken(user, true);

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'refresh' },
        { secret: 'refresh_secret', expiresIn: 3600 },
      );
      expect(result).toBe(token);
    });

    it('should issue an access token', async () => {
      const result = await authService.issueToken(user, false);

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'access' },
        { secret: 'access_secret', expiresIn: 900 },
      );
      expect(result).toBe(token);
    });
  });

  describe('signIn', () => {
    const rawToken = 'Basic token';
    const email = 'test@gmail.com';
    const password = '#Test@123$Password!';
    const user = { id: 1 };

    it('should sign in a user', async () => {
      jest
        .spyOn(authService, 'parseBasicToken')
        .mockResolvedValue({ email, password });
      jest
        .spyOn(authService, 'validateUser')
        .mockResolvedValue(user as UserEntity);
      jest.spyOn(authService, 'issueToken').mockResolvedValue('token');

      const result = await authService.signIn(rawToken);

      expect(authService.parseBasicToken).toHaveBeenCalledWith(rawToken);
      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
      expect(authService.issueToken).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ refreshToken: 'token', accessToken: 'token' });
    });
  });
});
