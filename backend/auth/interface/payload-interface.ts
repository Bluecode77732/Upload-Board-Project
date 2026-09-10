import { UserRole } from '../role/role';

// 최소한의 JWT 페이로드.
export interface Payload {
  // 조회용 유저 ID.
  sub: number;

  // access/refresh 토큰을 구분한다.
  type: 'refresh' | 'access';

  // 리프레시 토큰 전용: 같은 초에 발급된 두 토큰이 서명을 공유하지 않도록 하는
  // 무작위 유일 id — 회전/재사용 탐지(ADR 0012)는 발급되는 모든 리프레시 토큰이
  // 서로 달라야 한다는 전제에 의존한다.
  jti?: string;

  // 액세스 토큰 전용(ADR 0028): 클라이언트가 추가 요청 없이 자신의 role을 읽을 수 있게 한다.
  // 순수 광고용(advisory)일 뿐이다 — RolesGuard/AuthUser는 이 클레임을 절대 읽지 않고
  // 매 요청 JwtStrategy.validate의 실시간 DB 조회 결과를 쓰므로, role 변경 후 오래된 클레임이
  // 남아 있어도 남은 access-token TTL 동안 클라이언트 UI를 혼동시킬 뿐 서버 판정을 우회하지 못한다.
  role?: UserRole;

  // `iat/exp`는 JWT 라이브러리가 자동으로 처리한다.
}
