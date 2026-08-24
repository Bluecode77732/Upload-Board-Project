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

// What `targetId` actually points at, per action — it is polymorphic, not a user id.
// Verified against every auditLogService.log() call site in the backend:
//   ROLE_CHANGE    user.service.ts updateRole  -> user id
//   USER_DELETE    user.service.ts remove      -> user id
//   FILE_DELETE    file.service.ts deleteFile  -> file id
//   POST_DELETE    post.service.ts deletePost  -> post id
//   COMMENT_DELETE comment.service.ts          -> comment id
const TARGET_NOUN: Record<string, string> = {
    ROLE_CHANGE: 'User',
    USER_DELETE: 'User',
    FILE_DELETE: 'File',
    POST_DELETE: 'Post',
    COMMENT_DELETE: 'Comment',
};

// Renders an audit row's target for display. Every row used to read "User {targetId}",
// which was wrong for the three actions whose target is a file/post/comment — an operator
// reading "FILE_DELETE ... User 313" would be looking at file 313 and blaming user 313.
// An unrecognized action falls back to a bare "#id" rather than guessing a noun.
export function targetLabel(action: string, targetId: number | null): string {
    if (targetId === null) return '—';
    const noun = TARGET_NOUN[action];
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
