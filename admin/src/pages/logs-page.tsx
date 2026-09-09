// 목적: 권한 있는 작업의 audit trail을 읽기 전용으로 보여준다 (backend ADR 0013).
// 사용처: /logs에서 렌더링되며, 모든 페이지의 nav bar와 users-page.tsx의 "View all" 링크
// (`/logs?userId={id}`)에서 연결된다.
// 근거: 원본은 userId/from/to 필터 세트, 클라이언트 측 정렬 토글, 이 API에 없는 CSV 내보내기를
// 다루던 Chat Project 페이지를 그대로 가져온 것이었다 — admin/README.md의 backlog 표 참고.
// GET /audit-log의 정렬 순서는 createdAt DESC로 서버에 고정되어 있다(정렬 파라미터가 없다).
// `AuditLogQueryDto`는 2026-08-12에 `userId`를 추가했고, 이 페이지는 이제 URL에서 그 값을
// 읽는다. actor이거나, 사용자를 대상으로 한 action의 target(`targetType = 'user'`)일 때
// 매칭된다 — file/post/comment id가 사용자 id와 겹칠 수 있어서, backend ADR 0045로
// "targetId가 일치하면 무조건"에서 이렇게 좁혀졌다. `/audit-log/export` 엔드포인트는 여전히
// 없으므로, CSV 내보내기는 기존 필터가 적용된 쿼리를 페이지 단위로 순회해 EXPORT_CAP까지
// 클라이언트에서 합성한다.

import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { clearSessionUser } from '../auth/session-guard';
import { actionColor, targetLabel, type AuditLog } from '../lib/audit';
import ThemeToggle from '../components/theme-toggle';

// backend/audit-log/dto/audit-log-query.dto.ts의 AUDIT_ACTIONS를 그대로 반영한다.
const ACTIONS = ['ROLE_CHANGE', 'USER_DELETE', 'FILE_DELETE', 'POST_DELETE', 'COMMENT_DELETE'];
const TAKE = 20;
// AuditLogQueryDto.take는 100으로 상한(@Max(100))이 걸려 있다 — 내보내기가 한 번의
// 왕복에서 요청할 수 있는 최대 페이지 크기다.
const EXPORT_PAGE_SIZE = 100;
// CSV 다운로드에 포함할 행 수의 하드 상한이며, 실제 총 개수와 무관하다 — 더 필요한
// 관리자는 무제한 파일을 내보내는 대신 필터를 좁혀야 한다.
const EXPORT_CAP = 1000;
// `targetType`은 `targetId`와 나란히 붙는다 (backend ADR 0045). 그래야 내보낸 파일이
// target 컬럼이 어떤 종류의 id를 담고 있는지 알려준다 — 없으면 FILE_DELETE 행의 "269"가
// user id로 읽히는데, 이는 화면상의 Target 컬럼에서 이미 고쳐졌던 것과 같은 모호함이다.
const CSV_COLUMNS = ['id', 'createdAt', 'action', 'actorId', 'targetType', 'targetId', 'detail'] as const;

function csvEscape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

// 서버 측 내보내기가 없으므로, 조회한 audit-log 행들을 고정된 컬럼 순서
// (id, createdAt, action, actorId, targetType, targetId, detail)로 CSV 텍스트로
// 직렬화한다. `targetType`은 백엔드가 이 값을 보내기 시작하면서 스키마에 추가됐고
// (ADR 0045), null이면 `targetId`가 null일 때와 마찬가지로 빈 필드로 기록한다.
function toCsv(rows: AuditLog[]): string {
    const header = CSV_COLUMNS.join(',');
    const lines = rows.map((row) =>
        [row.id, row.createdAt, row.action, row.actorId, row.targetType ?? '', row.targetId ?? '', row.detail ?? '']
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

    // state가 아니라 파생값이다 — 이 필터는 URL(`?userId=`)이 유일한 진실 소스이므로,
    // users-page.tsx의 "View all" 링크(`/logs?userId={id}`)로 새로 진입해도 별도의
    // 동기화 단계 없이 그대로 반영된다.
    const userIdParam = searchParams.get('userId');
    const userId = userIdParam !== null && /^\d+$/.test(userIdParam) ? Number(userIdParam) : null;

    // setLoading(true)는 의도적으로 이 effect 본문에 넣지 않았다 (react-hooks/set-state-in-effect) —
    // changeAction(), changePage(), clearUserFilter()가 각각 이 effect를 재실행시키는
    // 의존성을 갱신하기 전에 미리 호출한다.
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

    // exportCsv: 현재의 action/userId 필터를 적용한 채 GET /audit-log를 EXPORT_PAGE_SIZE
    // (DTO의 take 상한) 단위로 순회하다가 EXPORT_CAP 또는 빈 페이지에서 멈추고, 결과를
    // CSV로 다운로드한다 — /audit-log/export 엔드포인트는 존재하지 않는다.
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

    // 목적: 이 탭의 관리자 세션을 서버·스토어·sessionStorage 세 곳 모두에서 끝낸다.
    // 이유: clearTokens만 부르면 sessionStorage의 세션 소유자 id가 로그아웃 후에도 남아,
    //       다음 계정으로 로그인한 세션이 첫 refresh에서 강제 로그아웃됐다 (session-guard.ts).
    // 방법: /auth/signout으로 서버 앵커를 지우고(실패해도 진행), clearTokens + clearSessionUser로
    //       로컬 흔적을 모두 비운 뒤 로그인 화면으로 이동한다.
    const signOut = async () => {
        try { await api.post('/auth/signout'); } catch { /* best effort */ }
        clearTokens();
        clearSessionUser();
        navigate('/');
    };

    const totalPages = Math.max(1, Math.ceil(total / TAKE));

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold dark:text-gray-100">Audit Logs</h1>
                    <div className="flex gap-3 items-center">
                        <button onClick={() => navigate('/dashboard')} data-testid="nav-dashboard" className="text-sm text-blue-600 hover:underline dark:text-blue-400">Dashboard</button>
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline dark:text-blue-400">Users</button>
                        <ThemeToggle />
                        <button onClick={signOut} data-testid="sign-out-button" className="text-sm text-red-600 hover:underline dark:text-red-400">Sign out</button>
                    </div>
                </div>

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <label className="text-sm text-gray-600 dark:text-gray-400">Action</label>
                    <select
                        value={action}
                        onChange={(e) => changeAction(e.target.value)}
                        data-testid="log-action-filter"
                        className="text-sm border rounded px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                        <option value="">All</option>
                        {ACTIONS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>

                    {userId !== null && (
                        <span data-testid="user-filter-banner" className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 rounded px-3 py-1 dark:bg-blue-900 dark:text-blue-200">
                            Filtering by user {userId}
                            <button
                                onClick={clearUserFilter}
                                data-testid="clear-user-filter"
                                className="text-blue-500 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-100 font-medium"
                            >
                                ✕
                            </button>
                        </span>
                    )}

                    <button
                        onClick={() => { void exportCsv(); }}
                        disabled={exporting}
                        data-testid="export-csv-button"
                        className="ml-auto text-sm px-3 py-1 rounded border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950"
                    >
                        {exporting ? 'Exporting...' : 'Export CSV'}
                    </button>
                </div>

                {loadError && (
                    <p data-testid="load-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2 dark:text-red-200 dark:bg-red-900">{loadError}</p>
                )}

                {exportError && (
                    <p data-testid="export-error-message" className="mb-4 text-sm text-red-700 bg-red-50 rounded px-3 py-2 dark:text-red-200 dark:bg-red-900">{exportError}</p>
                )}

                {exportCapped && (
                    <p data-testid="export-capped-banner" className="mb-4 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 dark:text-amber-200 dark:bg-amber-900">
                        1000건까지만 포함되었습니다. 필터로 좁혀서 나머지를 확인하세요.
                    </p>
                )}

                {loading ? (
                    <p className="text-gray-500 dark:text-gray-400">Loading...</p>
                ) : (
                    <>
                        <div data-testid="logs-table" className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto" tabIndex={0}>
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100 dark:bg-gray-700 text-left dark:text-gray-200">
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
                                        <tr key={log.id} data-testid={`log-row-${log.id}`} className="border-t dark:border-gray-700 dark:text-gray-200">
                                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {new Date(log.createdAt).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">User {log.actorId}</td>
                                            <td className="px-4 py-3">{targetLabel(log.targetType, log.targetId)}</td>
                                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{log.detail ?? '—'}</td>
                                        </tr>
                                    ))}
                                    {logs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">No logs yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between items-center mt-4 text-sm text-gray-600 dark:text-gray-400">
                            <span>Page {page} of {totalPages} ({total} total)</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => changePage(Math.max(1, page - 1))}
                                    disabled={page <= 1}
                                    className="px-3 py-1 rounded border disabled:opacity-40 dark:border-gray-600"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => changePage(Math.min(totalPages, page + 1))}
                                    disabled={page >= totalPages}
                                    className="px-3 py-1 rounded border disabled:opacity-40 dark:border-gray-600"
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
