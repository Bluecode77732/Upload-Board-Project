import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { UserEntity } from 'backend/user/entity/user.entity';

@Injectable()
export class LocalStrategy extends PassportStrategy(
  Strategy,
  'local-auth-guard',
) {
  constructor(private readonly authService: AuthService) {
    super({
      // Change request variable names
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  // 목적: 폼 필드(email/password)로 넘어온 자격 증명을 검증해 request.user에 실릴 사용자를 만든다.
  // 이유: POST /auth/signin/local은 Basic 토큰이 아니라 body 필드로 로그인받는 대안 경로다 —
  //       판정 자체는 signIn과 동일한 AuthService.validateUser를 재사용해 갈라지지 않게 한다.
  // 방법: AuthService.validateUser에 위임 — 실패 시 그 서비스가 이미 AUTH_INVALID_CREDENTIALS
  //       401(ErrorBody 계약 준수)을 던지므로 여기선 성공한 UserEntity만 그대로 반환한다.
  //       2026-09-03, 도달 불가능했던 if(!user) + 계약 위반 평문 예외 제거.
  async validate(email: string, password: string): Promise<UserEntity> {
    return this.authService.validateUser(email, password);
  }
}
