// Purpose: read-only view of the privileged-action audit trail (backend ADR 0013).
// Usage: rendered at /logs; linked from every page's nav bar, and from users-page.tsx's
// "View all" link (`/logs?userId={id}`).
// Rationale: rewritten from the imported Chat Project page, which targeted a userId/from/to
// filter set, a client-side sort toggle, and a CSV export this API did not have — see
// admin/README.md's backlog table. GET /audit-log's order is server-fixed at createdAt DESC
// (no sort parameter exists). `AuditLogQueryDto` gained `userId` (matches actor or target)
// 2026-08-12; this page now reads it from the URL. There is still no `/audit-log/export`
// endpoint, so CSV export is synthesized client-side by paging through the existing filtered
// query and capping at EXPORT_CAP records.

import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { actionColor, type AuditLog } from '../lib/audit';

// Mirrors backend/audit-log/dto/audit-log-query.dto.ts's AUDIT_ACTIONS exactly.
const ACTIONS = ['ROLE_CHANGE', 'USER_DELETE', 'FILE_DELETE', 'POST_DELETE', 'COMMENT_DELETE'];
const TAKE = 20;
// AuditLogQueryDto.take is capped at 100 (@Max(100)) — the largest page size export can
// request per round trip.
const EXPORT_PAGE_SIZE = 100;
// Hard ceiling on rows included in a CSV download, independent of the real total — an
// admin who needs more narrows the filter instead of exporting an unbounded file.
const EXPORT_CAP = 1000;
const CSV_COLUMNS = ['id', 'createdAt', 'action', 'actorId', 'targetId', 'detail'] as const;

function csvEscape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

// Serializes fetched audit-log rows into CSV text with a fixed column order
// (id, createdAt, action, actorId, targetId, detail), since there is no server-side export.
function toCsv(rows: AuditLog[]): string {
    const header = CSV_COLUMNS.join(',');
    const lines = rows.map((row) =>
        [row.id, row.createdAt, row.action, row.actorId, row.targetId ?? '', row.detail ?? '']
            .map((value) => csvEscape(String(value)))
            .join(','),
    );
    return [header, ...lines].join('\n');
}

function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function LogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [loadError, setLoadError] = useState('');
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [exportCapped, setExportCapped] = useState(false);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const clearTokens = useAuthStore((s) => s.clearTokens);

    // Derived, not stateful — the URL (`?userId=`) is the single source of truth for this
    // filter so a fresh navigation from users-page.tsx's "View all" link (`/logs?userId={id}`)
    // is reflected with no separate sync step.
    const userIdParam = searchParams.get('userId');
    const userId = userIdParam !== null && /^\d+$/.test(userIdParam) ? Number(userIdParam) : null;

    // setLoading(true) is intentionally NOT in this effect body (react-hooks/set-state-in-effect) —
    // changeAction(), changePage(), and clearUserFilter() each set it before updating the
    // dependency that re-triggers this.
    useEffect(() => {
        let cancelled = false;
        api.get('/audit-log', {
            params: { action: action || undefined, userId: userId ?? undefined, take: TAKE, skip: (page - 1) * TAKE },
        })
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
    }, [action, page, userId]);

    const changeAction = (value: string) => {
        setLoading(true);
        setAction(value);
        setPage(1);
    };

    const changePage = (newPage: number) => { setLoading(true); setPage(newPage); };

    const clearUserFilter = () => {
        setLoading(true);
        setPage(1);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('userId');
            return next;
        });
    };

    // exportCsv: pages through GET /audit-log at EXPORT_PAGE_SIZE (the DTO's take ceiling)
    // with the current action/userId filters applied, stopping at EXPORT_CAP or an empty
    // page, then downloads the result as CSV — there is no /audit-log/export endpoint.
    const exportCsv = async () => {
        setExporting(true);
        setExportError('');
        setExportCapped(false);
        try {
            const collected: AuditLog[] = [];
            let skip = 0;
            let serverTotal = Infinity;
            while (collected.length < EXPORT_CAP && skip < serverTotal) {
                const res = await api.get('/audit-log', {
                    params: { action: action || undefined, userId: userId ?? undefined, take: EXPORT_PAGE_SIZE, skip },
                });
                const [data, count] = res.data as [AuditLog[], number];
                serverTotal = count;
                if (data.length === 0) break;
                collected.push(...data);
                skip += EXPORT_PAGE_SIZE;
            }
            const rows = collected.slice(0, EXPORT_CAP);
            downloadCsv(toCsv(rows), 'audit-log.csv');
            setExportCapped(rows.length < serverTotal);
        } catch {
            setExportError('Failed to export logs.');
        } finally {
            setExporting(false);
        }
    };

    const signOut = async () => {
        try { await api.post('/auth/signout'); } catch { /* best effort */ }
        clearTokens();
        navigate('/');
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

                    {userId !== null && (
                        <span data-testid="user-filter-banner" className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 rounded px-3 py-1">
                            Filtering by user {userId}
                            <button
                                onClick={clearUserFilter}
                                data-testid="clear-user-filter"
                                className="text-blue-500 hover:text-blue-800 font-medium"
                            >
                                ✕
                            </button>
                        </span>
                    )}

                    <button
                        onClick={() => { void exportCsv(); }}
                        disabled={exporting}
                        data-testid="export-csv-button"
                        className="ml-auto text-sm px-3 py-1 rounded border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                    >
                        {exporting ? 'Exporting...' : 'Export CSV'}
                    </button>
                </div>

                {loadError && (
                    <p data-testid="load-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2">{loadError}</p>
                )}

                {exportError && (
                    <p data-testid="export-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2">{exportError}</p>
                )}

                {exportCapped && (
                    <p data-testid="export-capped-banner" className="mb-4 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
                        1000건까지만 포함되었습니다. 필터로 좁혀서 나머지를 확인하세요.
                    </p>
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
