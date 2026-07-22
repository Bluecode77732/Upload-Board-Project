import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async parseBasicToken(rawToken: string) {
    const basicToken = rawToken.split(' ');

    if (basicToken.length !== 2) {
      throw new BadRequestException('Bad token format.');
    }

    const [basic, token] = basicToken;

    if (basic.toLowerCase() !== 'basic') {
      throw new BadRequestException('Bad token format.');
    }

    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const tokenSplit = decoded.split(':');

    if (tokenSplit.length !== 2) {
      throw new BadRequestException('Bad token format.');
    }

    const [email, password] = tokenSplit;

    return { email, password };
  }

  async register(rawToken: string) {
    const { email, password } = await this.parseBasicToken(rawToken);

    const user = await this.userRepository.findOne({ where: { email } });

    if (user) {
      throw new BadRequestException('User already exists.');
    }

    const hash = await bcrypt.hash(
      password,
      this.configService.getOrThrow<number>('HASH_ROUNDS'),
    );

    await this.userRepository.save({ email, password: hash });

    return this.userRepository.findOne({ where: { email } });
  }

  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      throw new BadRequestException('Invalid credentials.');
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      throw new BadRequestException('Invalid credentials.');
    }

    return user;
  }

  async issueToken(user: Pick<UserEntity, 'id'>, isRefreshToken: boolean) {
    const refreshSecret = this.configService.getOrThrow<string>(
      'REFRESH_TOKEN_SECRET',
    );
    const accessSecret = this.configService.getOrThrow<string>(
      'ACCESS_TOKEN_SECRET',
    );

    const payload: Payload = {
      sub: user.id,
      type: isRefreshToken ? 'refresh' : 'access',
    };

    return this.jwtService.signAsync(payload, {
      secret: isRefreshToken ? refreshSecret : accessSecret,
      expiresIn: isRefreshToken
        ? this.configService.getOrThrow<number>(
            'REFRESH_TOKEN_SECRET_EXPIRES_IN',
          )
        : this.configService.getOrThrow<number>(
            'ACCESS_TOKEN_SECRET_EXPIRES_IN',
          ),
    });
  }

  async parseBearerToken(rawToken: string, isRefreshToken: boolean) {
    try {
      const bearerToken = rawToken.split(' ');

      if (bearerToken.length !== 2) {
        throw new BadRequestException('Bad token format.');
      }

      const [bearer, token] = bearerToken;

      if (bearer.toLowerCase() !== 'bearer') {
        throw new BadRequestException('Bad token format.');
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>(
          isRefreshToken ? 'REFRESH_TOKEN_SECRET' : 'ACCESS_TOKEN_SECRET',
        ),
      });

      if (isRefreshToken) {
        if (payload.type !== 'refresh') {
          throw new BadRequestException('Insert refresh token.');
        }
      } else {
        if (payload.type !== 'access') {
          throw new BadRequestException('Insert access token.');
        }
      }

      return payload;
    } catch (err) {
      throw new UnauthorizedException('Token expired.');
    }
  }

  async signIn(rawToken: string) {
    const { email, password } = await this.parseBasicToken(rawToken);
    const user = await this.validateUser(email, password);

    return {
      refreshToken: await this.issueToken(user, true),
      accessToken: await this.issueToken(user, false),
    };
  }
}
