// Purpose: landing page after login — shows at-a-glance stats (user count, recent logs).
// Usage: rendered at /dashboard; linked from App.tsx and all page nav bars.
// Rationale: admins previously landed on /users with no overview; a dashboard reduces navigation burden.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuthStore } from '../store/auth.store';

interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    action: string;
    detail: string | null;
    createdAt: string;
}

// This backend has no presence/room concept (that was the Chat Project's domain) — the
// dashboard's only cross-cutting stat is the user count, backed by GET /user's total.
function DashboardPage() {
    const [userTotal, setUserTotal] = useState<number | null>(null);
    const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
    const [statsLoading, setStatsLoading] = useState(true);
    const navigate = useNavigate();
    const clearTokens = useAuthStore((s) => s.clearTokens);

    useEffect(() => {
        Promise.all([
            api.get('/user', { params: { take: 1, skip: 0 } }),
            api.get('/audit-log', { params: { take: 5, skip: 0 } }),
        ])
            .then(([usersRes, logsRes]) => {
                setUserTotal((usersRes.data as [unknown[], number])[1]);
                setRecentLogs((logsRes.data as [AuditLog[], number])[0]);
            })
            .finally(() => setStatsLoading(false));
    }, []);

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

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Dashboard</h1>
                    <div className="flex gap-3">
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline">Users</button>
                        <button onClick={() => navigate('/logs')} data-testid="nav-logs" className="text-sm text-blue-600 hover:underline">Logs</button>
                        <button onClick={signOut} data-testid="sign-out-button" className="text-sm text-red-600 hover:underline">Sign out</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mb-8">
                    <div data-testid="stat-users" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Users</p>
                        <p className="text-3xl font-bold">{statsLoading ? '—' : userTotal}</p>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-4 py-3 bg-gray-100 text-sm font-semibold">Recent Audit Logs</div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-gray-500">
                            <tr>
                                <th className="px-4 py-2">Time</th>
                                <th className="px-4 py-2">Action</th>
                                <th className="px-4 py-2">Actor</th>
                                <th className="px-4 py-2">Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            {statsLoading ? (
                                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
                            ) : recentLogs.length === 0 ? (
                                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No logs yet.</td></tr>
                            ) : recentLogs.map((log) => (
                                <tr key={log.id} className="border-t">
                                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>{log.action}</span>
                                    </td>
                                    <td className="px-4 py-3">User {log.actorId}</td>
                                    <td className="px-4 py-3 text-gray-500">{log.detail ?? '—'}</td>
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
