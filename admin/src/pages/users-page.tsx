// Purpose: lists accounts and operates the RBAC role hierarchy (ADR 0013) — the console's
// primary purpose (ADR 0022).
// Usage: rendered at /users; linked from every page's nav bar.
// Rationale: rewritten from the imported Chat Project page, which targeted a numeric 2-tier
// role and ban/unban/force-logout actions this API does not have — see admin/README.md's
// backlog table for the full defect list. Search (email `ILIKE`) and sortable ID/Email/Created
// headers were re-added 2026-08-12 once GetUsersDto gained search/sortBy/order; there is still
// no `status` filter (none exists server-side) and no moderation actions.

import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type UserRole } from '../store/auth.store';
import { ROLE_RANK, ROLE_LABEL } from '../auth/role';
import { actionColor, type AuditLog } from '../lib/audit';

interface User {
    id: number;
    email: string;
    role: UserRole;
    createdAt: string;
    updatedAt: string;
}

const TAKE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const RECENT_ACTIVITY_TAKE = 5;
const ROLE_OPTIONS: UserRole[] = ['user', 'admin', 'superadmin'];
const ROLE_COLOR: Record<UserRole, string> = {
    user: 'bg-gray-100 text-gray-600',
    admin: 'bg-purple-100 text-purple-700',
    superadmin: 'bg-red-100 text-red-700',
};

// Mirrors backend/user/dto/get-users.dto.ts's USER_SORT_FIELDS — `role` is deliberately
// excluded there (a 3-tier string enum carries little sort meaning), so it is not a
// clickable header here either.
type SortField = 'id' | 'email' | 'createdAt';
type SortOrder = 'ASC' | 'DESC';

const COLUMN_LABEL: Record<SortField, string> = {
    id: 'ID',
    email: 'Email',
    createdAt: 'Created',
};

// The frozen { code, message } contract (backend ADR 0011) — branch on code, not message.
function errorCode(err: unknown): string | undefined {
    if (isAxiosError(err)) {
        return (err.response?.data as { code?: string } | undefined)?.code;
    }
    return undefined;
}

function errorMessage(err: unknown): string | undefined {
    if (isAxiosError(err)) {
        const message = (err.response?.data as { message?: string | string[] } | undefined)?.message;
        return Array.isArray(message) ? message.join(' ') : message;
    }
    return undefined;
}

function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [refreshKey, setRefreshKey] = useState(0);
    const [actionMsg, setActionMsg] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<SortField>('createdAt');
    const [order, setOrder] = useState<SortOrder>('DESC');
    const [recentActivity, setRecentActivity] = useState<AuditLog[]>([]);
    const [recentActivityLoading, setRecentActivityLoading] = useState(false);

    const navigate = useNavigate();
    const myRole = useAuthStore((s) => s.role);
    const clearTokens = useAuthStore((s) => s.clearTokens);

    // Debounces searchInput into `search` (the value actually sent to GET /user) so every
    // keystroke doesn't trigger a request; also resets to page 1 since a new search term
    // invalidates the current page's offset. Guarded by a no-op check against the current
    // `search` value — without it, the effect firing on mount (or after its own update)
    // would setLoading(true) with no dependency change left to fetch and flip it back.
    useEffect(() => {
        const handle = setTimeout(() => {
            const trimmed = searchInput.trim();
            if (trimmed === search) return;
            setLoading(true);
            setSearch(trimmed);
            setPage(1);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [searchInput, search]);

    // setLoading(true) is intentionally NOT in this effect body (react-hooks/set-state-in-effect) —
    // refresh(), changePage(), toggleSort(), and the search debounce above each set it before
    // updating the dependency that re-triggers this.
    useEffect(() => {
        let cancelled = false;
        api.get('/user', {
            params: {
                take: TAKE,
                skip: (page - 1) * TAKE,
                search: search || undefined,
                sortBy,
                order,
            },
        })
            .then((res) => {
                if (cancelled) return;
                const [data, count] = res.data as [User[], number];
                setUsers(data);
                setTotal(count);
            })
            .catch(() => { if (!cancelled) setActionMsg('Failed to load users.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [page, refreshKey, search, sortBy, order]);

    // Fetches the 5 most recent audit-log records naming this user (actor or target) for
    // the detail panel's "Recent activity" section. No-op while the panel is closed —
    // stale data is harmless since the panel that would show it is unmounted.
    // setRecentActivityLoading(true) is intentionally NOT in this effect body
    // (react-hooks/set-state-in-effect) — selectRow() sets it before selecting the user
    // that re-triggers this, the same pattern refresh()/changePage() use above.
    useEffect(() => {
        if (!selectedUser) return;
        let cancelled = false;
        api.get('/audit-log', { params: { userId: selectedUser.id, take: RECENT_ACTIVITY_TAKE, skip: 0 } })
            .then((res) => {
                if (cancelled) return;
                const [data] = res.data as [AuditLog[], number];
                setRecentActivity(data);
            })
            .catch(() => { if (!cancelled) setRecentActivity([]); })
            .finally(() => { if (!cancelled) setRecentActivityLoading(false); });
        return () => { cancelled = true; };
    }, [selectedUser]);

    const refresh = () => { setLoading(true); setRefreshKey((k) => k + 1); };

    const changePage = (next: number) => { setLoading(true); setPage(next); };

    const selectRow = (u: User) => { setRecentActivityLoading(true); setSelectedUser(u); };

    // toggleSort: clicking the active column flips its direction; clicking a different
    // column switches to it, defaulting to ascending.
    const toggleSort = (field: SortField) => {
        setLoading(true);
        if (sortBy === field) {
            setOrder((o) => (o === 'ASC' ? 'DESC' : 'ASC'));
        } else {
            setSortBy(field);
            setOrder('ASC');
        }
        setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(total / TAKE));

    // updateRole: PATCH /user/:id/role is superadmin-only and has no rank restriction on the
    // target beyond refusing to demote the last superadmin (400 AUTH_LAST_SUPERADMIN) — any
    // role, including the actor's own, can be reassigned.
    const updateRole = async (id: number, role: UserRole) => {
        try {
            await api.patch(`/user/${id}/role`, { role });
            setActionMsg(`User ${id} role updated to ${role}.`);
            refresh();
        } catch (err) {
            if (errorCode(err) === 'AUTH_LAST_SUPERADMIN') {
                setActionMsg('Cannot demote the last superadmin.');
            } else {
                setActionMsg(`Failed to update role for user ${id}.`);
            }
        }
    };

    // deleteUser: DELETE /user/:id. An account that still owns files is refused with
    // 409 USER_HAS_FILES until the request confirms the cascade via ?deleteFiles=true
    // (ADR 0020) — irreversibly deletes those files too, so it needs its own confirmation.
    const deleteUser = async (id: number) => {
        if (!confirm(`Delete user ${id}? This is irreversible.`)) return;
        try {
            await api.delete(`/user/${id}`);
            setActionMsg(`User ${id} deleted.`);
            refresh();
            setSelectedUser(null);
        } catch (err) {
            if (errorCode(err) === 'USER_HAS_FILES') {
                const detail = errorMessage(err) ?? 'This account still owns files.';
                if (confirm(`${detail} Delete the account AND every file it owns? This is irreversible.`)) {
                    try {
                        await api.delete(`/user/${id}`, { params: { deleteFiles: 'true' } });
                        setActionMsg(`User ${id} deleted.`);
                        refresh();
                        setSelectedUser(null);
                    } catch {
                        setActionMsg(`Failed to delete user ${id}.`);
                    }
                }
                return;
            }
            if (errorCode(err) === 'USER_FILES_IN_USE') {
                setActionMsg(
                    errorMessage(err) ??
                    `User ${id} owns a file attached to another user's post — remove that post first.`,
                );
                return;
            }
            if (errorCode(err) === 'FORBIDDEN') {
                setActionMsg(`Cannot delete user ${id}: equal or higher role.`);
                return;
            }
            setActionMsg(`Failed to delete user ${id}.`);
        }
    };

    const signOut = async () => {
        try {
            await api.post('/auth/signout');
        } catch {
            // best effort
        } finally {
            clearTokens();
            navigate('/');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Users</h1>
                    <div className="flex gap-3">
                        <button
                            onClick={() => navigate('/dashboard')}
                            data-testid="nav-dashboard"
                            className="text-sm text-blue-600 hover:underline"
                        >
                            Dashboard
                        </button>
                        <button
                            onClick={() => navigate('/logs')}
                            data-testid="nav-logs"
                            className="text-sm text-blue-600 hover:underline"
                        >
                            Logs
                        </button>
                        <button
                            onClick={signOut}
                            data-testid="sign-out-button"
                            className="text-sm text-red-600 hover:underline"
                        >
                            Sign out
                        </button>
                    </div>
                </div>

                {actionMsg && (
                    <p data-testid="action-message" className="mb-4 text-sm text-blue-700 bg-blue-50 rounded px-3 py-2">{actionMsg}</p>
                )}

                <div className="mb-4">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search by email..."
                        data-testid="user-search-input"
                        className="w-full max-w-sm text-sm border rounded px-3 py-2"
                    />
                </div>

                {loading ? (
                    <p className="text-gray-500">Loading...</p>
                ) : (
                    <div className="bg-white rounded-xl shadow overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 text-left">
                                <tr>
                                    {(['id', 'email', 'createdAt'] as SortField[]).map((field) => (
                                        <th
                                            key={field}
                                            onClick={() => toggleSort(field)}
                                            data-testid={`user-sort-${field}`}
                                            className="px-4 py-3 cursor-pointer select-none hover:bg-gray-200"
                                        >
                                            {COLUMN_LABEL[field]}
                                            {sortBy === field && (
                                                <span className="ml-1">{order === 'ASC' ? '▲' : '▼'}</span>
                                            )}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3">Role</th>
                                    <th className="px-4 py-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => (
                                    <tr
                                        key={u.id}
                                        data-testid={`user-row-${u.id}`}
                                        onClick={() => selectRow(u)}
                                        className={`border-t cursor-pointer hover:bg-gray-50${selectedUser?.id === u.id ? ' bg-blue-50' : ''}`}
                                    >
                                        <td className="px-4 py-3">{u.id}</td>
                                        <td className="px-4 py-3">{u.email}</td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                            {new Date(u.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span data-testid={`user-role-${u.id}`} className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[u.role]}`}>
                                                {ROLE_LABEL[u.role]}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 flex gap-2 flex-wrap items-center" onClick={(e) => e.stopPropagation()}>
                                            {myRole === 'superadmin' && (
                                                <select
                                                    value={u.role}
                                                    onChange={(e) => updateRole(u.id, e.target.value as UserRole)}
                                                    data-testid={`user-role-select-${u.id}`}
                                                    className="text-xs border rounded px-1 py-1"
                                                >
                                                    {ROLE_OPTIONS.map((r) => (
                                                        <option key={r} value={r}>{r}</option>
                                                    ))}
                                                </select>
                                            )}
                                            {myRole !== null && ROLE_RANK[myRole] > ROLE_RANK[u.role] && (
                                                <button
                                                    onClick={() => deleteUser(u.id)}
                                                    data-testid={`user-delete-${u.id}`}
                                                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {!loading && (
                    <div className="flex justify-between items-center mt-4 text-sm text-gray-600">
                        <span>Page {page} of {totalPages} ({total} total)</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => changePage(Math.max(1, page - 1))}
                                disabled={page <= 1}
                                className="px-3 py-1 rounded border disabled:opacity-40"
                            >
                                Prev
                            </button>
                            <button
                                onClick={() => changePage(Math.min(totalPages, page + 1))}
                                disabled={page >= totalPages}
                                className="px-3 py-1 rounded border disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* User detail panel — slides in from the right when a row is clicked. Shows
                the fields the list response already carries, plus a "Recent activity"
                slice from GET /audit-log?userId=... (actor or target, newest 5). */}
            {selectedUser && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setSelectedUser(null)}
                    data-testid="panel-backdrop"
                >
                    <div
                        className="absolute right-0 top-0 h-full w-96 bg-white shadow-2xl overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                        data-testid="user-detail-panel"
                    >
                        <div className="flex justify-between items-center px-5 py-4 border-b">
                            <h2 className="font-semibold text-gray-800">User Detail</h2>
                            <button
                                onClick={() => setSelectedUser(null)}
                                data-testid="panel-close"
                                className="text-gray-400 hover:text-gray-700 text-lg leading-none"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="px-5 py-4 space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">ID</span>
                                <span className="font-mono">{selectedUser.id}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Email</span>
                                <span className="truncate max-w-48">{selectedUser.email}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-500">Role</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[selectedUser.role]}`}>
                                    {ROLE_LABEL[selectedUser.role]}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Joined</span>
                                <span className="text-gray-600">{new Date(selectedUser.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Updated</span>
                                <span className="text-gray-600">{new Date(selectedUser.updatedAt).toLocaleString()}</span>
                            </div>
                        </div>

                        <div className="border-t px-5 py-4">
                            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Recent activity</h3>
                            {recentActivityLoading ? (
                                <p className="text-sm text-gray-400">Loading...</p>
                            ) : recentActivity.length === 0 ? (
                                <p className="text-sm text-gray-400">No activity yet.</p>
                            ) : (
                                <ul data-testid="recent-activity-list" className="space-y-2">
                                    {recentActivity.map((log) => (
                                        <li key={log.id} data-testid={`recent-activity-${log.id}`} className="text-sm">
                                            <div className="flex items-center justify-between">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                                <span className="text-gray-400 text-xs">
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            {log.detail && (
                                                <p className="text-gray-500 text-xs mt-1">{log.detail}</p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <button
                                onClick={() => navigate(`/logs?userId=${selectedUser.id}`)}
                                data-testid="recent-activity-view-all"
                                className="mt-3 text-sm text-blue-600 hover:underline"
                            >
                                View all →
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UsersPage;
