import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { GET_USER_NICKNAMES } from '../api/graphql-operations';

interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    action: string;
    detail: string | null;
    created: string;
}

interface AuditLogPage {
    data: AuditLog[];
    total: number;
    page: number;
    take: number;
}

const ACTIONS = ['ROLE_CHANGE', 'FORCE_LOGOUT', 'USER_DELETE', 'USER_UNBAN', 'USER_MUTED', 'USER_BANNED'];

function LogsPage() {
    const [result, setResult] = useState<AuditLogPage>({ data: [], total: 0, page: 1, take: 20 });
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<'DESC' | 'ASC'>('DESC');
    // userId filter: selects logs where the chosen user was actor OR target.
    // Resolved from the nicknameById map so the dropdown shows names, not raw IDs.
    const [userId, setUserId] = useState<number | undefined>(undefined);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [exportError, setExportError] = useState('');
    const [loadError, setLoadError] = useState('');
    const navigate = useNavigate();
    const clearTokens = useAuthStore((s) => s.clearTokens);
    const { data: nicknamesData } = useQuery<{ getUserNicknames: Array<{ id: string; nickname: string | null }> }>(GET_USER_NICKNAMES, {
        pollInterval: 60000,
    });
    const nicknameById = new Map(
        nicknamesData?.getUserNicknames.map((u) => [Number(u.id), u.nickname]) ?? []
    );
    const displayName = (id: number) => nicknameById.get(id) || `User ${id}`;

    useEffect(() => {
        let cancelled = false;
        api.get('/audit-log', { params: { action: action || undefined, page, sort, userId, from: from || undefined, to: to || undefined } })
            .then((res) => { if (!cancelled) { setResult(res.data as AuditLogPage); setLoadError(''); setLoading(false); } })
            .catch(() => { if (!cancelled) { setLoadError('Failed to load logs.'); setLoading(false); } });
        return () => { cancelled = true; };
    }, [action, page, sort, userId, from, to]);

    const changeAction = (value: string) => {
        setLoading(true);
        setAction(value);
        setPage(1);
    };

    // changeUser: resets to page 1 so the new filter starts from the beginning.
    const changeUser = (value: string) => {
        setLoading(true);
        setUserId(value ? Number(value) : undefined);
        setPage(1);
    };

    const changeFrom = (value: string) => {
        setLoading(true);
        setFrom(value);
        setPage(1);
    };

    const changeTo = (value: string) => {
        setLoading(true);
        setTo(value);
        setPage(1);
    };

    const toggleSort = () => {
        setLoading(true);
        setSort((s) => (s === 'DESC' ? 'ASC' : 'DESC'));
        setPage(1);
    };

    const changePage = (newPage: number) => {
        setLoading(true);
        setPage(newPage);
    };

    // exportCsv: downloads the currently-applied filters as a CSV file (no pagination —
    // capped server-side). Mirrors the on-screen filter state exactly.
    const exportCsv = async () => {
        setExportError('');
        try {
            const res = await api.get<Blob>('/audit-log/export', {
                params: { action: action || undefined, sort, userId, from: from || undefined, to: to || undefined },
                responseType: 'blob',
            });
            const url = URL.createObjectURL(res.data);
            const link = document.createElement('a');
            link.href = url;
            link.download = `audit-log-export-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch {
            setExportError('Failed to export logs.');
        }
    };

    const signOut = async () => {
        try { await api.post('/auth/signOut'); } catch { /* best effort */ }
        clearTokens();
        navigate('/');
    };

    const actionColor = (action: string) => {
        if (action === 'ROLE_CHANGE') return 'bg-indigo-100 text-indigo-700';
        if (action === 'FORCE_LOGOUT') return 'bg-yellow-100 text-yellow-700';
        if (action === 'USER_DELETE') return 'bg-red-100 text-red-700';
        if (action === 'USER_UNBAN') return 'bg-green-100 text-green-700';
        if (action === 'USER_MUTED') return 'bg-orange-100 text-orange-700';
        if (action === 'USER_BANNED') return 'bg-rose-100 text-rose-700';
        return 'bg-gray-100 text-gray-600';
    };

    const totalPages = Math.max(1, Math.ceil(result.total / result.take));

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Audit Logs</h1>
                    <div className="flex gap-3">
                        <button onClick={() => navigate('/dashboard')} data-testid="nav-dashboard" className="text-sm text-blue-600 hover:underline">Dashboard</button>
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline">Users</button>
                        <button onClick={() => navigate('/rooms')} data-testid="nav-rooms" className="text-sm text-blue-600 hover:underline">Rooms</button>
                        <button onClick={signOut} data-testid="sign-out-button" className="text-sm text-red-600 hover:underline">Sign out</button>
                    </div>
                </div>

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <label className="text-sm text-gray-600">Action</label>
                    <select
                        value={action}
                        onChange={(e) => changeAction(e.target.value)}
                        data-testid="log-action-filter"
                        className="text-sm border rounded px-2 py-1"
                    >
                        <option value="">All</option>
                        {ACTIONS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>

                    <label className="text-sm text-gray-600">User</label>
                    {/* User dropdown: shows all known users by nickname.
                        Sends userId to backend which returns logs where actorId OR targetId matches. */}
                    <select
                        value={userId ?? ''}
                        onChange={(e) => changeUser(e.target.value)}
                        data-testid="log-user-filter"
                        className="text-sm border rounded px-2 py-1"
                    >
                        <option value="">All</option>
                        {Array.from(nicknameById.entries()).map(([id, nickname]) => (
                            <option key={id} value={id}>{nickname ?? `User ${id}`}</option>
                        ))}
                    </select>

                    <label className="text-sm text-gray-600">From</label>
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => changeFrom(e.target.value)}
                        data-testid="log-from-filter"
                        className="text-sm border rounded px-2 py-1"
                    />
                    <label className="text-sm text-gray-600">To</label>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => changeTo(e.target.value)}
                        data-testid="log-to-filter"
                        className="text-sm border rounded px-2 py-1"
                    />

                    <button
                        onClick={exportCsv}
                        data-testid="log-export-csv"
                        className="ml-auto text-sm px-3 py-1.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                        Export CSV
                    </button>
                </div>

                {exportError && (
                    <p data-testid="export-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2">{exportError}</p>
                )}

                {loadError && (
                    <p data-testid="load-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2">{loadError}</p>
                )}

                {loading ? (
                    <p className="text-gray-500">Loading...</p>
                ) : (
                    <>
                        <div data-testid="logs-table" className="bg-white rounded-xl shadow overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100 text-left">
                                    <tr>
                                        <th className="px-4 py-3">
                                            <button onClick={toggleSort} className="hover:underline cursor-pointer font-bold">
                                                Time
                                            </button>
                                        </th>
                                        <th className="px-4 py-3">Action</th>
                                        <th className="px-4 py-3">Actor</th>
                                        <th className="px-4 py-3">Target</th>
                                        <th className="px-4 py-3">Detail</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.data.map((log) => (
                                        <tr key={log.id} data-testid={`log-row-${log.id}`} className="border-t">
                                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                                {new Date(log.created).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">{displayName(log.actorId)}</td>
                                            <td className="px-4 py-3">{log.targetId !== null ? displayName(log.targetId) : '—'}</td>
                                            <td className="px-4 py-3 text-gray-500">{log.detail ?? '—'}</td>
                                        </tr>
                                    ))}
                                    {result.data.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No logs yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

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
                    </>
                )}
            </div>
        </div>
    );
}

export default LogsPage;