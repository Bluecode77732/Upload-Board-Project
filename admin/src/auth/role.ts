// Purpose: mirrors backend/auth/role/role.ts's rank ordering for client-side gating.
// Usage: imported by protected-route.tsx, login-page.tsx, users-page.tsx wherever a role
// needs to be compared, not just read — the server is still the source of truth on every write.
// Rationale: the imported console encoded roles as numbers (0/1/2); this project's UserRole
// is a string enum, so rank comparisons need a lookup instead of a numeric compare.

import type { UserRole } from '../store/auth.store';

export const ROLE_RANK: Record<UserRole, number> = {
    user: 0,
    admin: 1,
    superadmin: 2,
};

export const ROLE_LABEL: Record<UserRole, string> = {
    user: 'user',
    admin: 'admin',
    superadmin: 'superadmin',
};
