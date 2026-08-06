// Purpose: read-only view of the privileged-action audit trail (backend ADR 0013).
// Usage: rendered at /logs; linked from every page's nav bar.
// Rationale: rewritten from the imported Chat Project page, which targeted a userId/from/to
// filter set, a client-side sort toggle, and a CSV export this API does not have — see
// admin/README.md's backlog table. GET /audit-log's order is server-fixed at createdAt DESC
// (no sort parameter exists), and its only filter is `action`.

import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    action: string;
    detail: string | null;
    createdAt: string;
}

// Mirrors backend/audit-log/dto/audit-log-query.dto.ts's AUDIT_ACTIONS exactly.
const ACTIONS = ['ROLE_CHANGE', 'USER_DELETE', 'FILE_DELETE', 'POST_DELETE', 'COMMENT_DELETE'];
const TAKE = 20;

function LogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [loadError, setLoadError] = useState('');
    const navigate = useNavigate();
    const clearTokens = useAuthStore((s) => s.clearTokens);

    // setLoading(true) is intentionally NOT in this effect body (react-hooks/set-state-in-effect) —
    // changeAction() and changePage() each set it before updating the dependency that re-triggers this.
    useEffect(() => {
        let cancelled = false;
        api.get('/audit-log', { params: { action: action || undefined, take: TAKE, skip: (page - 1) * TAKE } })
            .then((res) => {
                if (cancelled) return;
                const [data, count] = res.data as [AuditLog[], number];
                setLogs(data);
                setTotal(count);
                setLoadError('');
            })
            .catch(() => { if (!cancelled) setLoadError('Failed to load logs.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [action, page]);

    const changeAction = (value: string) => {
        setLoading(true);
        setAction(value);
        setPage(1);
    };

    const changePage = (newPage: number) => { setLoading(true); setPage(newPage); };

    const signOut = async () => {
        try { await api.post('/auth/signout'); } catch { /* best effort */ }
        clearTokens();
        navigate('/');
    };

    const actionColor = (action: string) => {
        if (action === 'ROLE_CHANGE') return 'bg-indigo-100 text-indigo-700';
        if (action === 'USER_DELETE') return 'bg-red-100 text-red-700';
        if (action === 'FILE_DELETE') return 'bg-orange-100 text-orange-700';
        if (action === 'POST_DELETE') return 'bg-rose-100 text-rose-700';
        if (action === 'COMMENT_DELETE') return 'bg-amber-100 text-amber-700';
        return 'bg-gray-100 text-gray-600';
    };

    const totalPages = Math.max(1, Math.ceil(total / TAKE));

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Audit Logs</h1>
                    <div className="flex gap-3">
                        <button onClick={() => navigate('/dashboard')} data-testid="nav-dashboard" className="text-sm text-blue-600 hover:underline">Dashboard</button>
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline">Users</button>
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
                </div>

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
                                        {/* Newest-first is server-fixed (no sort parameter) — not a toggle button. */}
                                        <th className="px-4 py-3">Time</th>
                                        <th className="px-4 py-3">Action</th>
                                        <th className="px-4 py-3">Actor</th>
                                        <th className="px-4 py-3">Target</th>
                                        <th className="px-4 py-3">Detail</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} data-testid={`log-row-${log.id}`} className="border-t">
                                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                                {new Date(log.createdAt).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">User {log.actorId}</td>
                                            <td className="px-4 py-3">{log.targetId !== null ? `User ${log.targetId}` : '—'}</td>
                                            <td className="px-4 py-3 text-gray-500">{log.detail ?? '—'}</td>
                                        </tr>
                                    ))}
                                    {logs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No logs yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

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
                    </>
                )}
            </div>
        </div>
    );
}

export default LogsPage;
