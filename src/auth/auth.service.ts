import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { UserEntity } from 'src/user/entity/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Payload } from './interface/payload-interface';

@Injectable()
export class AuthService {
  constructor(
    // Inject the TypeORM repository for User Entity to use in DB.
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) { };


  async parseBasicToken(rawToken: string) {

    // 1. Splits token by basic and token. Regex(/\s+/) inserted for clearer space.
    // ['Basic', token]
    const basicToken = rawToken.split(" ");

    // 2. If the token length `[Basic token]` isn't 2, throw `BadRequestException` since it's wrong approach for parsing token.
    if (basicToken.length !== 2) {
      throw new BadRequestException('Bad Token Format.');
    };

    // 3. Extracts and sort out by basic and token from the splitted rawToken once again.
    const [basic, token] = basicToken;

    // 4. Verifies the token.
    if (basic.toLowerCase() !== 'basic') {
      throw new BadRequestException('Bad Token Format.');
    };

    // 5. Decodes extracted raw token from HTTP headers, then convert into readable code.
    const decoded = Buffer.from(token, 'base64').toString('utf-8');

    // 6. Split the decoded token by email and password.
    const tokenSplit = decoded.split(":");

    // 7. Verifies if the token includes basic.
    if (!(tokenSplit.length == 2)) {
      throw new BadRequestException('Bad Token Format.');
    };

    // 8. Extract email and password for returning to client.
    const [email, password] = tokenSplit;

    // 9. Return result.
    return {
      email,
      password,
    };
  }


  async register(rawToken: string) {

    // Extracts email and password from basic token
    const { email, password } = await this.parseBasicToken(rawToken);

    // Finds user by email
    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    // Verifies if user exist or not
    if (user) {
      throw new BadRequestException("User Already Exist.");
    };

    // Hashing the password by bcrypt in secret hashing rounds
    const hash = await bcrypt.hash(password, this.configService.getOrThrow<number>('HASH_ROUNDS'));

    // Stores user email and hashed password by TypeORM method
    await this.userRepository.save({
      email,
      password: hash,
    });

    // Finds user's email returning to client by TypeORM method
    return await this.userRepository.findOne({
      where: {
        email,
      },
    });
  };


  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (!user) {
      throw new BadRequestException("Invalid User.");
    };

    const verification = await bcrypt.compare(password, user.password);

    if (!verification) {
      throw new BadRequestException("Invalid User.");
    };

    return user;
  };


  async issueToken(user: UserEntity, isRefreshToken: boolean) {

    // Bring refreshToken and accessToken to issue token for creating user accessing validation.
    const refreshToken = this.configService.getOrThrow<string>('REFRESH_TOKEN_SECRET');
    const accessToken = this.configService.getOrThrow<string>('ACCESS_TOKEN_SECRET');

    const payload: Payload = {
      sub: user.id,
      type: isRefreshToken ? 'refresh' : 'access',
    };

    // Since Nodejs single thread feature cannot process another request synchronously as the event loop gets blocked, creating JWT token asynchronously enhances the throughput getting other requests.
    return await this.jwtService.signAsync(
      payload,
      // `JwtSignOptions` Can also be set in `auth.module.ts` file, since it requires separated tokens, the options should be set manually.
      {
        secret: isRefreshToken ? refreshToken : accessToken,
        expiresIn: isRefreshToken ? this.configService.getOrThrow<number>("REFRESH_TOKEN_SECRET_EXPIRES_IN") : this.configService.getOrThrow<number>("ACCESS_TOKEN_SECRET_EXPIRES_IN"),
      },
    );
  };


  async parseBearerToken(rawToken: string, isRefreshToken: boolean) {
    // This try/catch throws an unified error as JWT throws various error types
    try {
      const bearerToken = rawToken.split(' ');

      if (!(bearerToken.length == 2)) {
        throw new BadRequestException("Bad Token Format.");
      };

      const [bearer, token] = bearerToken;

      if (bearer.toLowerCase() !== "bearer") {
        throw new BadRequestException("Bad Token Format.");
      };

      const payload = await this.jwtService.verifyAsync(
        token,
        {
          secret: this.configService.getOrThrow<string>(
            isRefreshToken ? "REFRESH_TOKEN_SECRET" : "ACCESS_TOKEN_SECRET"
          ),
        },
      );

      if (isRefreshToken) {
        if (payload.type !== "refresh") {
          throw new BadRequestException("Insert Refresh Token.");
        };
      } else {
        if (payload.type !== "access") {
          throw new BadRequestException("Insert Access Token.");
        }
      };

      return payload;

    } catch (err) {

      throw new UnauthorizedException("Token Expired");
    }
  }


  async signIn(rawToken: string) {

    // Extracts email and password
    const { email, password } = await this.parseBasicToken(rawToken);

    // Authenticates email and password
    const user = await this.validateUser(email, password);

    return {
      refreshToken: await this.issueToken(user, true),
      accessToken: await this.issueToken(user, false),
    };
  };
}
