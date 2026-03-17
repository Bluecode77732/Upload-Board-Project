import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';


describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: Repository<UserEntity>;
  let configService: ConfigService;
  let jwtService: JwtService;
  
  // Mocking 
  const mockUserEntity: UserEntity = {
    id: 1,
    email: "test@gmail.com",
    password: "Test123Password",
    creator: [],
    files: [],
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
    // Testing basic mocks
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
    userRepository = module.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    configService = module.get<ConfigService>(ConfigService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  })


  describe("parseBasicToken", () => {
    it("should parse valid basic token", async () => {
      // Create base64 encoded token => email:password
      const token = Buffer.from("test@gmail.com:Test123Password").toString('base64');
      const rawToken = `Basic ${token}`;

      const result = await authService.parseBasicToken(rawToken);

      expect(result.email).toBe("test@gmail.com");
      expect(result.password).toBe("Test123Password");
    });

    it("should throw `BadRequestException` for invalid token format", () => {
      const InvalidRawToken = "InvalidTokenFormat";
      expect(authService.parseBasicToken(InvalidRawToken)).rejects.toThrow(BadRequestException);
    });

    it("should throw an error for invalid basic token format", () => {
      const InvalidRawToken = "Basic token";
      expect(authService.parseBasicToken(InvalidRawToken)).rejects.toThrow(BadRequestException);
    });

    it("should throw an error for invalid refresh access token format", () => {
      const InvalidBearerToken = "Bearer token";
      expect(authService.parseBasicToken(InvalidBearerToken)).rejects.toThrow(BadRequestException);
    });
  });


  describe("parseBearerToken", () => {
    it("should parse a bearer token", async () => {
      const rawToken = "BearerToken";
      const payload = { type: "access" };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload);
      jest.spyOn(mockConfigService, 'getOrThrow').mockResolvedValue('secret');

      const result = await authService.parseBearerToken(rawToken, false);

      expect(result).toEqual(payload);
    });

    it("should throw BadRequestException for invalid token format", async () => {
      const token = "InvalidTokenFormat";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new BadRequestException("Bad Token Format"));
    });

    it("should throw BadRequestException for not a bearer token", async () => {
      const token = "bEaReR token";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new BadRequestException("Bad Token Format"));
    });

    it("should throw UnauthorizedException for not a refresh token", async () => {
      const token = "token";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new UnauthorizedException("Token Expired"));
    });
  });


  describe("register", () => {
    // Base64 authentication decoded format => email:password => convert into utf-8 readable string
    const token = Buffer.from("test@gmail.com:Test123Password").toString('utf-8');
    const BasicToken = `Basic ${token}`;
    const hashRounds = 10;
    const email = "test@gmail.com";
    const password = "Test123Password";
    const hashedPassword = "HashedPassword";

    it("should register a new user", async () => {
      // Mocking user's findOne to resolve value
      mockUserRepository.findOne
        .mockResolvedValue(null)
        .mockResolvedValueOnce({ email: "test@gmail.com", password: hashedPassword });
      // Mocking user's save to resolve value
      mockUserRepository.save.mockResolvedValueOnce({ email: "test@gmail.com", password: "Test123Password" });
      // Mocking ConfigService's getOrThrow to resolve value
      mockConfigService.getOrThrow.mockResolvedValue(hashRounds);

      // `bcrypt.compare` is async, thus it returns a `Promise`.
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashedPassword));

      const result = await authService.register(BasicToken);

      expect(bcrypt.hash).toHaveBeenCalledWith(password, hashRounds);
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ email: "test@gmail.com" });
      expect(result).toEqual({ email, password: "Test123Password" });
    });

    it("should throw `BadRequestException` when user already Exist", async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUserEntity);

      await expect(authService.register(BasicToken)).rejects.toThrow(new BadRequestException("User Aleady Exist."));

      // Testing that save wasn't called
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });


  describe("validateUser", () => {
    const email = "test@gmail.com";
    const password = "#Test@123$Password!";
    const user = {
      email,
      password: "Hashed@123!Password",
    };

      it("should validate user", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      // `bcrypt.compare` is async, thus it returns a `Promise`.
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      const result = await authService.validateUser(email, password);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email } });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, "Hashed@123!Password");
      expect(result).toEqual(user);
    });

    it("should throw a BadRequestException for invalid user", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(authService.validateUser(email, password)).rejects.toThrow(new BadRequestException("Invalid User."));
    });

    it("should throw a BadRequestException when user password is incorrect", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
      // jest.spyOn(bcrypt, 'compare').mockImplementation((a, b) => false);

      await expect(authService.validateUser(email, password)).rejects.toThrow(new BadRequestException("Invalid User."));
    });
  })


  describe("issueToken", () => {
    const user = { id: 1 };
    const token = "token";

    beforeEach(() => {
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');
      jest.spyOn(jwtService, 'signAsync').mockResolvedValue(token);
    })

    it("should issue an refresh token", async () => {
      const result = await authService.issueToken(user as UserEntity, true);

      // Jwt decoded payload
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'refresh' },
        { secret: 'refresh', expiresIn: 180 },
      );
      expect(result).toBe(token);
    });

    it("should issue an access token", async () => {
      const result = await authService.issueToken(user as UserEntity, false);

      // Jwt decoded payloads
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'access' },
        { secret: 'access', expiresIn: 180 },
      );
      expect(result).toBe(token);
    });
  });


  describe("signIn", () => {
    const rawToken = "Basic token";
    const email = "test@gmail.com";
    const password = "#Test@123$Password!";
    const user = {
      id: 1,
    };

    it("should sign in a user", async () => {
      jest.spyOn(authService, 'parseBasicToken').mockResolvedValue({ email, password });
      jest.spyOn(authService, 'validateUser').mockResolvedValue(user as UserEntity);
      jest.spyOn(authService, 'issueToken').mockResolvedValue("token");

      const result = await authService.signIn(rawToken);

      expect(authService.parseBasicToken).toHaveBeenCalledWith(rawToken);
      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
      expect(authService.issueToken).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        refreshToken: 'token',
        accessToken: 'token',
      });
    });
  })
});
