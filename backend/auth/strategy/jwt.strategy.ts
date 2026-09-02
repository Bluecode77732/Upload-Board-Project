import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payload } from '../interface/payload-interface';
import { UserEntity } from 'backend/user/entity/user.entity';
import { UserService } from 'backend/user/user.service';
import { ErrorCode } from 'backend/common/error-code';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-auth-guard') {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow('ACCESS_TOKEN_SECRET'),
    });
  }

  // 목적: 검증된 액세스 토큰 payload로부터 request.user에 실릴 사용자 정보를 만든다.
  // 이유: Passport가 서명/만료만 확인하고, "이 sub가 실제로 존재하는 유저인가"는 매 요청 DB
  //       조회로 이 계층에서 재확인해야 한다 — payload는 발급 시점 스냅샷일 뿐이다.
  // 방법: UserService.findOne으로 최신 상태를 읽고, password는 구조 분해로 제외해 반환한다
  //       (응답 직렬화와 별개로 request.user 자체에 원문 해시를 남기지 않기 위함).
  async validate(payload: Payload): Promise<Omit<UserEntity, 'password'>> {
    const user = await this.userService.findOne(payload.sub);

    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        message: 'User Not Found.',
      });
    }

    const { password, ...rest } = user;

    return rest;
  }
}
