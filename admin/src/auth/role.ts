// 목적: backend/auth/role/role.ts의 등급 순서를 클라이언트 측 권한 검사용으로 그대로 반영한다.
// 사용처: protected-route.tsx, login-page.tsx, users-page.tsx 등 역할을 단순 조회가 아니라
// 비교해야 하는 모든 곳에서 import한다 — 모든 쓰기 작업의 최종 검증은 여전히 서버가 담당한다.
// 근거: 원본 콘솔은 역할을 숫자(0/1/2)로 인코딩했지만, 이 프로젝트의 UserRole은 문자열 enum이라
// 등급 비교에 숫자 비교 대신 룩업 테이블이 필요하다.

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
