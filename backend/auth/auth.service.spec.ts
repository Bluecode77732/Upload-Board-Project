import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { Repository } from 'typeorm';
import { UserEntity } from 'backend/user/entity/user.entity';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

jest.mock('bcrypt');

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: Repository<UserEntity>;
  let jwtService: JwtService;

  const mockUserEntity: UserEntity = {
    id: 1,
    email: 'test@gmail.com',
    password: 'Test123Password',
    refreshTokenHash: null,
    creator: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
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
    it('should parse valid basic token', () => {
      const token = Buffer.from('test@gmail.com:Test123Password').toString(
        'base64',
      );
      const rawToken = `Basic ${token}`;

      const result = authService.parseBasicToken(rawToken);

      expect(result.email).toBe('test@gmail.com');
      expect(result.password).toBe('Test123Password');
    });

    it('should throw BadRequestException for invalid token format', () => {
      expect(() => authService.parseBasicToken('InvalidTokenFormat')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid basic token format', () => {
      expect(() => authService.parseBasicToken('Basic token')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for bearer token passed to parseBasicToken', () => {
      expect(() => authService.parseBasicToken('Bearer token')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid access token', async () => {
      const payload = { sub: 1, type: 'access' };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload);
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');

      const result = await authService.verifyToken('validtoken', false);

      expect(result).toEqual(payload);
    });

    it('should throw UnauthorizedException when the type claim mismatches', async () => {
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockResolvedValue({ sub: 1, type: 'refresh' });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');

      await expect(authService.verifyToken('token', false)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired/invalid token', async () => {
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockRejectedValue(new Error('jwt expired'));
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');

      await expect(authService.verifyToken('token', true)).rejects.toThrow(
        UnauthorizedException,
      );
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
        // jti: every refresh token is unique so reuse detection can tell
        // rotated-out tokens apart (ADR 0012).
        { sub: user.id, type: 'refresh', jti: expect.any(String) as string },
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

  describe('issueTokenPair', () => {
    it('should issue a pair and store the refresh-token hash', async () => {
      jest
        .spyOn(authService, 'issueToken')
        .mockResolvedValueOnce('refresh-token')
        .mockResolvedValueOnce('access-token');
      mockUserRepository.update.mockResolvedValue(undefined);

      const result = await authService.issueTokenPair({ id: 1 });

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        refreshTokenHash: sha256('refresh-token'),
      });
      expect(result).toEqual({
        refreshToken: 'refresh-token',
        accessToken: 'access-token',
      });
    });
  });

  describe('rotateRefreshToken', () => {
    const rawToken = 'raw-refresh-token';
    const payload = { sub: 1, type: 'refresh' };

    it('should throw UnauthorizedException when no token is presented', async () => {
      await expect(authService.rotateRefreshToken(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when no active session exists', async () => {
      jest.spyOn(authService, 'verifyToken').mockResolvedValue(payload);
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUserEntity,
        refreshTokenHash: null,
      });

      await expect(authService.rotateRefreshToken(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('should invalidate the session on reuse of a rotated-out token', async () => {
      jest.spyOn(authService, 'verifyToken').mockResolvedValue(payload);
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUserEntity,
        refreshTokenHash: sha256('a-newer-token'),
      });
      mockUserRepository.update.mockResolvedValue(undefined);

      await expect(authService.rotateRefreshToken(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        refreshTokenHash: null,
      });
    });

    it('should rotate when the presented token matches the stored hash', async () => {
      jest.spyOn(authService, 'verifyToken').mockResolvedValue(payload);
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUserEntity,
        refreshTokenHash: sha256(rawToken),
      });
      const pair = { refreshToken: 'new-refresh', accessToken: 'new-access' };
      jest.spyOn(authService, 'issueTokenPair').mockResolvedValue(pair);

      const result = await authService.rotateRefreshToken(rawToken);

      expect(authService.verifyToken).toHaveBeenCalledWith(rawToken, true);
      expect(authService.issueTokenPair).toHaveBeenCalled();
      expect(result).toEqual(pair);
    });
  });

  describe('signOut', () => {
    it('should clear the stored refresh-token hash', async () => {
      mockUserRepository.update.mockResolvedValue(undefined);

      await authService.signOut(1);

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        refreshTokenHash: null,
      });
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
        .mockReturnValue({ email, password });
      jest
        .spyOn(authService, 'validateUser')
        .mockResolvedValue(user as UserEntity);
      jest.spyOn(authService, 'issueToken').mockResolvedValue('token');
      mockUserRepository.update.mockResolvedValue(undefined);

      const result = await authService.signIn(rawToken);

      expect(authService.parseBasicToken).toHaveBeenCalledWith(rawToken);
      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
      expect(authService.issueToken).toHaveBeenCalledTimes(2);
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        refreshTokenHash: sha256('token'),
      });
      expect(result).toEqual({ refreshToken: 'token', accessToken: 'token' });
    });
  });
});
