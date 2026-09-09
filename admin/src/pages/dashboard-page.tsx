// 목적: 로그인 후 진입하는 첫 화면 — 사용자 수, 최근 로그 등 한눈에 보이는 통계를 보여준다.
// 사용처: /dashboard에서 렌더링되며, App.tsx와 모든 페이지 nav bar에서 링크된다.
// 근거: 예전에는 관리자가 개요 없이 바로 /users로 진입했다 — 대시보드가 그 탐색 부담을 줄인다.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuthStore } from '../store/auth.store';
import { clearSessionUser } from '../auth/session-guard';
import { actionColor, type AuditLog } from '../lib/audit';
import ThemeToggle from '../components/theme-toggle';

// 이 백엔드에는 접속 현황/room 개념이 없다 (그건 Chat Project의 영역이었다) — 대시보드의
// 통계 카드는 GET /user, GET /file, GET /post의 총합이다 (각각 take=1로 조회해 튜플의
// count 필드만 사용한다); 별도의 /stats 엔드포인트는 존재하지 않는다.
function DashboardPage() {
    const [userTotal, setUserTotal] = useState<number | null>(null);
    const [fileTotal, setFileTotal] = useState<number | null>(null);
    const [postTotal, setPostTotal] = useState<number | null>(null);
    const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
    const [statsLoading, setStatsLoading] = useState(true);
    const navigate = useNavigate();
    const clearTokens = useAuthStore((s) => s.clearTokens);

    useEffect(() => {
        Promise.all([
            api.get('/user', { params: { take: 1, skip: 0 } }),
            api.get('/file', { params: { take: 1, skip: 0 } }),
            api.get('/post', { params: { take: 1, skip: 0 } }),
            api.get('/audit-log', { params: { take: 5, skip: 0 } }),
        ])
            .then(([usersRes, filesRes, postsRes, logsRes]) => {
                setUserTotal((usersRes.data as [unknown[], number])[1]);
                setFileTotal((filesRes.data as [unknown[], number])[1]);
                setPostTotal((postsRes.data as [unknown[], number])[1]);
                setRecentLogs((logsRes.data as [AuditLog[], number])[0]);
            })
            .finally(() => setStatsLoading(false));
    }, []);

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

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold dark:text-gray-100">Dashboard</h1>
                    <div className="flex gap-3 items-center">
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline dark:text-blue-400">Users</button>
                        <button onClick={() => navigate('/logs')} data-testid="nav-logs" className="text-sm text-blue-600 hover:underline dark:text-blue-400">Logs</button>
                        <ThemeToggle />
                        <button onClick={signOut} data-testid="sign-out-button" className="text-sm text-red-600 hover:underline dark:text-red-400">Sign out</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div data-testid="stat-users" className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Users</p>
                        <p className="text-3xl font-bold dark:text-gray-100">{statsLoading ? '—' : userTotal}</p>
                    </div>
                    <div data-testid="stat-files" className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Files</p>
                        <p className="text-3xl font-bold dark:text-gray-100">{statsLoading ? '—' : fileTotal}</p>
                    </div>
                    <div data-testid="stat-posts" className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Posts</p>
                        <p className="text-3xl font-bold dark:text-gray-100">{statsLoading ? '—' : postTotal}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto" tabIndex={0}>
                    <div className="px-4 py-3 bg-gray-100 dark:bg-gray-700 text-sm font-semibold dark:text-gray-200">Recent Audit Logs</div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
                            <tr>
                                <th className="px-4 py-2">Time</th>
                                <th className="px-4 py-2">Action</th>
                                <th className="px-4 py-2">Actor</th>
                                <th className="px-4 py-2">Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            {statsLoading ? (
                                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">Loading...</td></tr>
                            ) : recentLogs.length === 0 ? (
                                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">No logs yet.</td></tr>
                            ) : recentLogs.map((log) => (
                                <tr key={log.id} className="border-t dark:border-gray-700">
                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>{log.action}</span>
                                    </td>
                                    <td className="px-4 py-3 dark:text-gray-200">User {log.actorId}</td>
                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{log.detail ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default DashboardPage;
