// Purpose: defines the three-tier role enum and its privilege ranking for RBAC comparisons.
// Usage: imported by RolesGuard/@Roles, UserEntity.role, and ownership checks (self OR admin).
// Rationale: Stage 0 RBAC (ADR 0013) needs one canonical role source; a string enum keeps DB values and Swagger readable.

export enum UserRole {
  user = 'user',
  admin = 'admin',
  superadmin = 'superadmin',
}

// Higher number = more privilege. Guards compare ranks so admin satisfies a
// user-level requirement without an exact match (string values are not ordered).
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.user]: 0,
  [UserRole.admin]: 1,
  [UserRole.superadmin]: 2,
};
