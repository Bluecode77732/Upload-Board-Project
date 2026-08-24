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
    // The discriminator for the polymorphic `targetId` (backend ADR 0045). Present on every
    // record — GET /audit-log returns entities directly — and nullable only because
    // `targetId` is: the backend's invariant is `targetType IS NULL` ⟺ `targetId IS NULL`.
    targetType: string | null;
    action: string;
    detail: string | null;
    createdAt: string;
}

// The noun to print per target kind. Keyed on the server's `targetType`, not on `action`:
// the previous TARGET_NOUN map keyed on action and had to re-derive the target's kind
// client-side, which duplicated knowledge the backend now stores in the row itself
// (ADR 0045 D2 — the read path deliberately carries no action -> target-kind mapping).
// A sixth action added server-side is therefore labeled correctly with no change here.
const TARGET_LABEL: Record<string, string> = {
    user: 'User',
    file: 'File',
    post: 'Post',
    comment: 'Comment',
};

// Renders an audit row's target for display. Every row used to read "User {targetId}",
// which was wrong for the three actions whose target is a file/post/comment — an operator
// reading "FILE_DELETE ... User 313" would be looking at file 313 and blaming user 313.
// Now reads the server's `targetType` instead of inferring it from `action`. A missing or
// unrecognized type falls back to a bare "#id" rather than guessing a noun — the only way
// to reach that branch is a row written by pre-ADR-0045 backend code after the migration.
export function targetLabel(targetType: string | null, targetId: number | null): string {
    if (targetId === null) return '—';
    const noun = targetType === null ? undefined : TARGET_LABEL[targetType];
    return noun ? `${noun} ${targetId}` : `#${targetId}`;
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
