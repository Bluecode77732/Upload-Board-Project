// 목적: 3단계 역할 enum과 RBAC 비교에 쓰이는 권한 순위를 정의한다.
// 사용처: RolesGuard/@Roles, UserEntity.role, 소유권 검사(self OR admin)에서 임포트.
// 근거: Stage 0 RBAC(ADR 0013)는 정본이 되는 역할 소스가 하나 필요하다; 문자열 enum은 DB 값과 Swagger를 읽기 쉽게 유지한다.

export enum UserRole {
  user = 'user',
  admin = 'admin',
  superadmin = 'superadmin',
}

// 숫자가 클수록 권한이 높다. 가드는 랭크를 비교하므로 admin은 정확히 일치하지 않아도
// user 수준 요구사항을 만족한다(문자열 값 자체는 순서가 없다).
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.user]: 0,
  [UserRole.admin]: 1,
  [UserRole.superadmin]: 2,
};
