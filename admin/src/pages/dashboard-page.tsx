// Purpose: landing page after login — shows at-a-glance stats (user count, room count, recent logs).
// Usage: rendered at /dashboard; linked from App.tsx and all page nav bars.
// Rationale: admins previously landed on /users with no overview; a dashboard reduces navigation burden.

import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuthStore } from '../store/auth.store';
import { GET_ALL_ROOMS, GET_USER_NICKNAMES, GET_ONLINE_USER } from '../api/graphql-operations';

interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    action: string;
    detail: string | null;
    created: string;
}

function DashboardPage() {
    const [userTotal, setUserTotal] = useState<number | null>(null);
    const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
    const [statsLoading, setStatsLoading] = useState(true);
    const navigate = useNavigate();
    const clearTokens = useAuthStore((s) => s.clearTokens);

    const { data: roomData } = useQuery<{ getAllRooms: { total: number } }>(
        GET_ALL_ROOMS,
        { variables: { page: 1, take: 1 } },
    );
    const roomTotal = roomData?.getAllRooms.total ?? null;

    // onlineUsers: IDs of currently connected users; count shown as stat card.
    const { data: onlineData } = useQuery<{ getOnlineUser: number[] }>(GET_ONLINE_USER, {
        pollInterval: 15000,
    });
    const onlineCount = onlineData?.getOnlineUser.length ?? null;

    // nicknameById: used to resolve actorId in the recent logs table.
    // Falls back to "User {id}" when the user has no nickname set.
    const { data: nicknamesData } = useQuery<{ getUserNicknames: Array<{ id: string; nickname: string | null }> }>(
        GET_USER_NICKNAMES,
        { pollInterval: 60000 },
    );
    const nicknameById = new Map(
        nicknamesData?.getUserNicknames.map((u) => [Number(u.id), u.nickname]) ?? []
    );
    const displayName = (id: number) => nicknameById.get(id) ?? `User ${id}`;

    useEffect(() => {
        Promise.all([
            api.get('/user', { params: { page: 1, take: 1, humanOnly: true } }),
            api.get('/audit-log', { params: { page: 1, take: 5, sort: 'DESC' } }),
        ])
            .then(([usersRes, logsRes]) => {
                setUserTotal((usersRes.data as { total: number }).total);
                setRecentLogs((logsRes.data as { data: AuditLog[] }).data);
            })
            .finally(() => setStatsLoading(false));
    }, []);

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

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Dashboard</h1>
                    <div className="flex gap-3">
                        <button onClick={() => navigate('/users')} data-testid="nav-users" className="text-sm text-blue-600 hover:underline">Users</button>
                        <button onClick={() => navigate('/rooms')} data-testid="nav-rooms" className="text-sm text-blue-600 hover:underline">Rooms</button>
                        <button onClick={() => navigate('/logs')} data-testid="nav-logs" className="text-sm text-blue-600 hover:underline">Logs</button>
                        <button onClick={signOut} data-testid="sign-out-button" className="text-sm text-red-600 hover:underline">Sign out</button>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-8">
                    <div data-testid="stat-users" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Users</p>
                        <p className="text-3xl font-bold">{statsLoading ? '—' : userTotal}</p>
                    </div>
                    <div data-testid="stat-rooms" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Total Rooms</p>
                        <p className="text-3xl font-bold">{roomTotal === null ? '—' : roomTotal}</p>
                    </div>
                    <div data-testid="stat-online" className="bg-white rounded-xl shadow p-5">
                        <p className="text-sm text-gray-500 mb-1">Online Now</p>
                        <p className="text-3xl font-bold">{onlineCount === null ? '—' : onlineCount}</p>
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
                                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(log.created).toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>{log.action}</span>
                                    </td>
                                    <td className="px-4 py-3">{displayName(log.actorId)}</td>
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
