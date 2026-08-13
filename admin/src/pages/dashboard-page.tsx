// Purpose: landing page after login — shows at-a-glance stats (user count, recent logs).
// Usage: rendered at /dashboard; linked from App.tsx and all page nav bars.
// Rationale: admins previously landed on /users with no overview; a dashboard reduces navigation burden.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuthStore } from '../store/auth.store';
import { actionColor, type AuditLog } from '../lib/audit';

// This backend has no presence/room concept (that was the Chat Project's domain) — the
// dashboard's stat cards are the GET /user, GET /file, and GET /post totals (each read via
// take=1 so the tuple's count is the only field used); no dedicated /stats endpoint exists.
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

    const signOut = async () => {
        try { await api.post('/auth/signout'); } catch { /* best effort */ }
        clearTokens();
        navigate('/');
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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div data-testid="stat-users" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Users</p>
                        <p className="text-3xl font-bold">{statsLoading ? '—' : userTotal}</p>
                    </div>
                    <div data-testid="stat-files" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Files</p>
                        <p className="text-3xl font-bold">{statsLoading ? '—' : fileTotal}</p>
                    </div>
                    <div data-testid="stat-posts" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Posts</p>
                        <p className="text-3xl font-bold">{statsLoading ? '—' : postTotal}</p>
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
