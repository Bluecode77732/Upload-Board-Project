import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payload } from '../interface/payload-interface';
import { UserEntity } from 'backend/user/entity/user.entity';
import { UserService } from 'backend/user/user.service';

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
  //       (응답 직렬화와 별개로 request.user 자체에 원문 해시를 남기지 않기 위함). findOne은
  //       못 찾으면 자체적으로 예외를 던지므로(never falsy 반환) 이 계층에서 null 체크를
  //       다시 하지 않는다 — 2026-09-03, 도달 불가능했던 if(!user) 가드 제거(CLAUDE.md
  //       Known gaps, 계정 삭제 시 상태 코드 잔여 이슈 참고).
  async validate(payload: Payload): Promise<Omit<UserEntity, 'password'>> {
    const { password, ...rest } = await this.userService.findOne(payload.sub);

    return rest;
  }
}
