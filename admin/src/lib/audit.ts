// Purpose: shared AuditLog shape + action-to-badge-color mapping.
// Usage: imported by dashboard-page.tsx, logs-page.tsx, users-page.tsx wherever an
// audit-log record is rendered.
// Rationale: the same interface and color mapping was duplicated identically across
// all three pages; users-page.tsx's new "Recent activity" panel would have made it a
// fourth copy.

export interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    action: string;
    detail: string | null;
    createdAt: string;
}

// Mirrors backend/audit-log/dto/audit-log-query.dto.ts's AUDIT_ACTIONS exactly.
export function actionColor(action: string): string {
    if (action === 'ROLE_CHANGE') return 'bg-indigo-100 text-indigo-700';
    if (action === 'USER_DELETE') return 'bg-red-100 text-red-700';
    if (action === 'FILE_DELETE') return 'bg-orange-100 text-orange-700';
    if (action === 'POST_DELETE') return 'bg-rose-100 text-rose-700';
    if (action === 'COMMENT_DELETE') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}
