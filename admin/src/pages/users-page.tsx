import { useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

interface User {
    id: number;
    email: string;
    nickname: string | null;
    role: number;
    created: string;
}

interface UserPage {
    data: User[];
    total: number;
    page: number;
    take: number;
}

// Fields returned by GET /user/:id that are not in the list response.
// status/bannedUntil come from the moderation layer; password is @Excluded by the interceptor.
interface UserDetail {
    status?: string;
    bannedUntil?: string | null;
}

interface AuditLogEntry {
    id: number;
    action: string;
    actorId: number;
    targetId: number | null;
    detail: string | null;
    created: string;
}

const ROLE_LABEL: Record<number, string> = { 0: 'user', 1: 'admin', 2: 'superadmin' };
const ROLE_COLOR: Record<number, string> = {
    0: 'bg-gray-100 text-gray-600',
    1: 'bg-purple-100 text-purple-700',
    2: 'bg-red-100 text-red-700',
};
const ACTION_COLOR: Record<string, string> = {
    ROLE_CHANGE: 'bg-indigo-100 text-indigo-700',
    FORCE_LOGOUT: 'bg-yellow-100 text-yellow-700',
    USER_DELETE: 'bg-red-100 text-red-700',
    USER_UNBAN: 'bg-green-100 text-green-700',
    USER_MUTED: 'bg-orange-100 text-orange-700',
    USER_BANNED: 'bg-rose-100 text-rose-700',
};

function UsersPage() {
    const [result, setResult] = useState<UserPage>({ data: [], total: 0, page: 1, take: 20 });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<'DESC' | 'ASC'>('DESC');
    const [sortBy, setSortBy] = useState<'id' | 'role' | 'created'>('id');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'banned'>('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [actionMsg, setActionMsg] = useState('');

    // selectedUser: the row that was clicked to open the detail panel.
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    // panelDetail: extra fields fetched from GET /user/:id (status, bannedUntil).
    // null while the fetch is in-flight; {} (empty) when done (success or error).
    const [panelDetail, setPanelDetail] = useState<UserDetail | null>(null);
    // panelLogs: recent 5 audit log entries involving the selected user.
    const [panelLogs, setPanelLogs] = useState<AuditLogEntry[]>([]);
    // panelRefreshKey: incrementing this re-triggers the panel fetch without changing selectedUser.
    // Used by unban() to reload moderation state after clearing a ban.
    const [panelRefreshKey, setPanelRefreshKey] = useState(0);
    // Derived — avoids synchronous setState inside the effect body.
    const panelLoading = selectedUser !== null && panelDetail === null;

    const navigate = useNavigate();
    const myRole = useAuthStore((s) => s.role);
    const clearTokens = useAuthStore((s) => s.clearTokens);

    // setLoading(true) is intentionally NOT in this effect body to satisfy react-hooks/set-state-in-effect.
    // Each trigger (changePage, toggleSort, handleSearch debounce, refresh) sets loading=true
    // in its own event handler or timer callback before updating the dependency.
    useEffect(() => {
        let cancelled = false;
        api.get('/user', { params: { page, take: 20, sort, sortBy, search: debouncedSearch || undefined, status: statusFilter || undefined } })
            .then((res) => { if (!cancelled) { setResult(res.data as UserPage); setLoading(false); } })
            .catch(() => { if (!cancelled) { setActionMsg('Failed to load users.'); setLoading(false); } });
        return () => { cancelled = true; };
    }, [page, sort, sortBy, debouncedSearch, statusFilter, refreshKey]);

    // Fetch panel data when a user row is selected or panelRefreshKey changes (e.g. after unban).
    // GET /user/:id for moderation state; GET /audit-log?userId for recent logs.
    // All setState calls are inside async callbacks — avoids react-hooks/set-state-in-effect.
    useEffect(() => {
        if (!selectedUser) return;
        let cancelled = false;
        Promise.all([
            api.get(`/user/${selectedUser.id}`),
            api.get('/audit-log', { params: { userId: selectedUser.id, take: 5, sort: 'DESC' } }),
        ])
            .then(([detailRes, logsRes]) => {
                if (cancelled) return;
                setPanelDetail(detailRes.data as UserDetail);
                setPanelLogs((logsRes.data as { data: AuditLogEntry[] }).data);
            })
            .catch(() => {
                // Panel is supplemental — mark done (non-null) so panelLoading clears.
                if (!cancelled) setPanelDetail({});
            });
        return () => { cancelled = true; };
    // panelRefreshKey is intentional: unban() increments it to reload moderation state
    // without changing selectedUser, so the panel re-fetches in place.
    }, [selectedUser, panelRefreshKey]);

    const refresh = () => { setLoading(true); setRefreshKey((k) => k + 1); };

    const changeStatusFilter = (value: '' | 'active' | 'banned') => {
        setLoading(true);
        setStatusFilter(value);
        setPage(1);
    };

    // openPanel: resets panel data in the event handler (not in an effect) so the
    // useEffect body only calls setState in async callbacks — satisfies react-hooks/set-state-in-effect.
    const openPanel = (u: User) => {
        setSelectedUser(u);
        setPanelDetail(null);
        setPanelLogs([]);
    };

    const handleSearch = (value: string) => {
        setSearch(value);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            setLoading(true);  // timer callback — not inside a useEffect body
            setDebouncedSearch(value);
            setPage(1);
        }, 300);
    };

    const toggleSort = (field: 'id' | 'role' | 'created') => {
        setLoading(true);  // event handler — not inside a useEffect body
        if (sortBy === field) {
            setSort((s) => (s === 'DESC' ? 'ASC' : 'DESC'));
        } else {
            setSortBy(field);
            setSort('DESC');
        }
        setPage(1);
    };

    const changePage = (next: number) => {
        setLoading(true);  // event handler — not inside a useEffect body
        setPage(next);
    };

    const totalPages = Math.max(1, Math.ceil(result.total / result.take));
    const users = result.data;

    const updateRole = async (id: number, role: number) => {
        try {
            await api.patch(`/user/${id}/role`, { role });
            setActionMsg(`User ${id} role updated to ${role === 1 ? 'admin' : 'user'}.`);
            refresh();
        } catch {
            setActionMsg(`Failed to update role for user ${id}.`);
        }
    };

    // unban: clears ban/mute/strikes via POST /user/:id/unban.
    // Resets panel data in the handler (not in an effect) and increments panelRefreshKey
    // to re-trigger the panel fetch — shows updated status without closing the panel.
    const unban = async (userId: number) => {
        try {
            await api.post(`/user/${userId}/unban`);
            setActionMsg(`User ${userId} unbanned.`);
            setPanelDetail(null);
            setPanelLogs([]);
            setPanelRefreshKey((k) => k + 1);
        } catch {
            setActionMsg(`Failed to unban user ${userId}.`);
        }
    };

    // ban: manual admin ban via POST /user/:id/ban, independent of the automatic strike system.
    // Prompts for an optional reason; Cancel aborts entirely (null), OK with empty input still bans.
    const ban = async (userId: number) => {
        const reason = prompt('Reason for ban (optional):');
        if (reason === null) return;
        try {
            await api.post(`/user/${userId}/ban`, reason ? { reason } : {});
            setActionMsg(`User ${userId} banned.`);
            setPanelDetail(null);
            setPanelLogs([]);
            setPanelRefreshKey((k) => k + 1);
        } catch {
            setActionMsg(`Failed to ban user ${userId}.`);
        }
    };

    const forceLogout = async (id: number) => {
        try {
            await api.post(`/user/${id}/force-logout`);
            setActionMsg(`User ${id} force-logged out.`);
        } catch {
            setActionMsg(`Failed to force logout user ${id}.`);
        }
    };

    const deleteUser = async (id: number) => {
        if (!confirm(`Delete user ${id}? This is irreversible.`)) return;
        try {
            await api.delete(`/user/${id}`);
            setActionMsg(`User ${id} deleted.`);
            refresh();
            setSelectedUser(null);
        } catch {
            setActionMsg(`Failed to delete user ${id}.`);
        }
    };

    const signOut = async () => {
        try {
            await api.post('/auth/signOut');
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
                            onClick={() => navigate('/rooms')}
                            data-testid="nav-rooms"
                            className="text-sm text-blue-600 hover:underline"
                        >
                            Rooms
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

                <div className="flex items-center gap-3 mb-4">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search by email or nickname..."
                        data-testid="user-search-input"
                        className="flex-1 text-sm border rounded px-3 py-2"
                    />
                    <label className="text-sm text-gray-600 whitespace-nowrap">Status</label>
                    <select
                        value={statusFilter}
                        onChange={(e) => changeStatusFilter(e.target.value as '' | 'active' | 'banned')}
                        data-testid="user-status-filter"
                        className="text-sm border rounded px-2 py-2"
                    >
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="banned">Banned</option>
                    </select>
                </div>

                {actionMsg && (
                    <p data-testid="action-message" className="mb-4 text-sm text-blue-700 bg-blue-50 rounded px-3 py-2">{actionMsg}</p>
                )}

                {loading ? (
                    <p className="text-gray-500">Loading...</p>
                ) : (
                    <div className="bg-white rounded-xl shadow overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 text-left">
                                <tr>
                                    <th className="px-4 py-3">
                                        <button onClick={() => toggleSort('id')} className={`hover:underline cursor-pointer${sortBy === 'id' ? ' font-bold' : ''}`}>
                                            ID
                                        </button>
                                    </th>
                                    <th className="px-4 py-3">Nickname</th>
                                    <th className="px-4 py-3">Email</th>
                                    <th className="px-4 py-3">
                                        <button onClick={() => toggleSort('role')} className={`hover:underline cursor-pointer${sortBy === 'role' ? ' font-bold' : ''}`}>
                                            Role
                                        </button>
                                    </th>
                                    <th className="px-4 py-3">
                                        <button onClick={() => toggleSort('created')} className={`hover:underline cursor-pointer${sortBy === 'created' ? ' font-bold' : ''}`}>
                                            Created
                                        </button>
                                    </th>
                                    <th className="px-4 py-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => (
                                    // Clicking the row opens the detail panel; action buttons stop propagation.
                                    <tr
                                        key={u.id}
                                        data-testid={`user-row-${u.id}`}
                                        onClick={() => openPanel(u)}
                                        className={`border-t cursor-pointer hover:bg-gray-50${selectedUser?.id === u.id ? ' bg-blue-50' : ''}`}
                                    >
                                        <td className="px-4 py-3">{u.id}</td>
                                        <td className="px-4 py-3">{u.nickname ?? '—'}</td>
                                        <td className="px-4 py-3">{u.email}</td>
                                        <td className="px-4 py-3">
                                            <span data-testid={`user-role-${u.id}`} className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                                                {ROLE_LABEL[u.role] ?? 'unknown'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                            {new Date(u.created).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                            {myRole === 2 && u.role !== 2 && (
                                                <button
                                                    onClick={() => updateRole(u.id, u.role === 1 ? 0 : 1)}
                                                    data-testid={`user-promote-${u.id}`}
                                                    className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                                >
                                                    {u.role === 1 ? 'Demote' : 'Promote'}
                                                </button>
                                            )}
                                            {myRole !== null && myRole > u.role && (
                                                <button
                                                    onClick={() => forceLogout(u.id)}
                                                    data-testid={`user-force-logout-${u.id}`}
                                                    className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                                >
                                                    Force logout
                                                </button>
                                            )}
                                            {myRole !== null && myRole > u.role && (
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
                        <span>Page {result.page} of {totalPages} ({result.total} total)</span>
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

            {/* User detail panel — slides in from the right when a row is clicked.
                Uses data already in the row plus GET /user/:id for moderation state
                and GET /audit-log?userId for the 5 most recent privileged-action entries. */}
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
                            <div className="flex justify-between">
                                <span className="text-gray-500">Nickname</span>
                                <span>{selectedUser.nickname ?? '—'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-500">Role</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[selectedUser.role] ?? ''}`}>
                                    {ROLE_LABEL[selectedUser.role] ?? 'unknown'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Joined</span>
                                <span className="text-gray-600">{new Date(selectedUser.created).toLocaleString()}</span>
                            </div>

                            {panelLoading ? (
                                <p className="text-gray-400 text-xs pt-2">Loading details…</p>
                            ) : (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Status</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                            panelDetail?.status === 'banned' ? 'bg-red-100 text-red-700' :
                                            'bg-green-100 text-green-700'
                                        }`}>
                                            {panelDetail?.status ?? 'active'}
                                        </span>
                                    </div>
                                    {panelDetail?.bannedUntil && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Banned until</span>
                                            <span className="text-red-600 text-xs">{new Date(panelDetail.bannedUntil).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {/* Unban: shown only when the user is currently banned and the actor outranks them. */}
                                    {panelDetail?.status === 'banned' && myRole !== null && myRole > selectedUser.role && (
                                        <div className="pt-1">
                                            <button
                                                onClick={() => unban(selectedUser.id)}
                                                data-testid={`panel-unban-${selectedUser.id}`}
                                                className="w-full text-xs px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200"
                                            >
                                                Unban
                                            </button>
                                        </div>
                                    )}
                                    {/* Ban: shown only when the user is not already banned and the actor outranks them. */}
                                    {panelDetail?.status !== 'banned' && myRole !== null && myRole > selectedUser.role && (
                                        <div className="pt-1">
                                            <button
                                                onClick={() => ban(selectedUser.id)}
                                                data-testid={`panel-ban-${selectedUser.id}`}
                                                className="w-full text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                            >
                                                Ban
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {!panelLoading && panelLogs.length > 0 && (
                            <div className="px-5 pb-5">
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Audit Logs</h3>
                                <ul className="space-y-2" data-testid="panel-audit-logs">
                                    {panelLogs.map((log) => (
                                        <li key={log.id} className="text-xs border rounded px-3 py-2 bg-gray-50">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`px-1.5 py-0.5 rounded font-medium ${ACTION_COLOR[log.action] ?? 'bg-gray-100 text-gray-600'}`}>
                                                    {log.action}
                                                </span>
                                                <span className="text-gray-400">{new Date(log.created).toLocaleString()}</span>
                                            </div>
                                            {log.detail && <p className="text-gray-500">{log.detail}</p>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {!panelLoading && panelLogs.length === 0 && (
                            <p className="px-5 text-xs text-gray-400">No audit log entries for this user.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default UsersPage;
