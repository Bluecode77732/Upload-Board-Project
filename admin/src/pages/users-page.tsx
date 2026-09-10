// 목적: 계정 목록을 보여주고 RBAC 역할 체계(ADR 0013)를 조작한다 — 이 콘솔의 핵심 목적이다
// (ADR 0022).
// 사용처: /users에서 렌더링되며, 모든 페이지의 nav bar에서 링크된다.
// 근거: 원본은 숫자형 2단계 role과 ban/unban/force-logout 액션을 다루던 Chat Project 페이지를
// 그대로 가져온 것이었는데, 이 API에는 그런 기능이 없다 — 전체 결함 목록은 admin/README.md의
// backlog 표 참고. 검색(email `ILIKE`)과 정렬 가능한 ID/Email/Created 헤더는 GetUsersDto에
// search/sortBy/order가 추가된 2026-08-12에 다시 도입했다; 서버에 없는 `status` 필터와
// 모더레이션 액션은 여전히 없다.

import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type UserRole } from '../store/auth.store';
import { clearSessionUser } from '../auth/session-guard';
import { ROLE_RANK, ROLE_LABEL } from '../auth/role';
import { actionColor, targetLabel, type AuditLog } from '../lib/audit';
import ThemeToggle from '../components/theme-toggle';

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
    user: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
    superadmin: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
};

// backend/user/dto/get-users.dto.ts의 USER_SORT_FIELDS를 그대로 반영한다 — 거기서 `role`이
// 의도적으로 빠져 있으므로(3단계 문자열 enum은 정렬 의미가 거의 없다) 여기서도 클릭 가능한
// 헤더로 넣지 않는다.
type SortField = 'id' | 'email' | 'createdAt';
type SortOrder = 'ASC' | 'DESC';

const COLUMN_LABEL: Record<SortField, string> = {
    id: 'ID',
    email: 'Email',
    createdAt: 'Created',
};

// 고정된 { code, message } 계약이다 (backend ADR 0011) — message가 아니라 code로 분기한다.
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

    // searchInput을 `search`(실제로 GET /user에 보내는 값)로 디바운스해서 키 입력마다
    // 요청이 발생하지 않게 한다; 새 검색어는 현재 페이지의 offset을 무효화하므로 페이지도
    // 1로 초기화한다. 현재 `search` 값과 비교하는 no-op 가드가 없으면, 마운트 시(또는
    // 자기 자신의 업데이트 이후)에도 effect가 실행되어 fetch로 다시 꺼줄 의존성 변화 없이
    // setLoading(true)만 호출하게 된다.
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

    // setLoading(true)는 의도적으로 이 effect 본문에 넣지 않았다 (react-hooks/set-state-in-effect) —
    // refresh(), changePage(), toggleSort(), 그리고 위의 검색 디바운스가 각각 이 effect를
    // 재실행시키는 의존성을 갱신하기 전에 미리 setLoading(true)를 호출한다.
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

    // 상세 패널의 "Recent activity" 섹션을 위해 이 사용자와 관련된 최근 audit-log 5건을
    // 가져온다 — actor이거나, 사용자를 대상으로 한 action의 target(`targetType = 'user'`)인
    // 경우다. target이 file/post/comment인 레코드는 actor 쪽으로만 매칭된다; 예전에는 id
    // 충돌로 여기 잘못 나타나곤 했다 (backend ADR 0045).
    // 패널이 닫혀 있는 동안은 아무 동작도 하지 않는다 — 그 데이터를 보여줄 패널 자체가
    // unmount되어 있으므로 오래된 데이터가 남아 있어도 문제없다.
    // setRecentActivityLoading(true)는 의도적으로 이 effect 본문에 넣지 않았다
    // (react-hooks/set-state-in-effect) — selectRow()가 이 effect를 재실행시키는 사용자
    // 선택보다 먼저 이를 호출한다. 위의 refresh()/changePage()와 같은 패턴이다.
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

    // toggleSort: 현재 활성 컬럼을 클릭하면 정렬 방향이 뒤집히고, 다른 컬럼을 클릭하면
    // 그 컬럼으로 전환되며 기본값은 오름차순이다.
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

    // updateRole: PATCH /user/:id/role은 superadmin 전용이며, 마지막 superadmin 강등을
    // 거부하는 것(400 AUTH_LAST_SUPERADMIN) 외에는 대상에 대한 등급 제한이 없다 — 실행자
    // 본인의 role을 포함해 어떤 role이든 재지정할 수 있다.
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

    // deleteUser: DELETE /user/:id. 파일을 여전히 소유한 계정은 요청이 ?deleteFiles=true로
    // 연쇄 삭제를 확인하기 전까지 409 USER_HAS_FILES로 거부된다 (ADR 0020) — 그 파일들도
    // 되돌릴 수 없이 함께 삭제되므로 별도의 확인이 필요하다.
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

    // 목적: 이 탭의 관리자 세션을 서버·스토어·sessionStorage 세 곳 모두에서 끝낸다.
    // 이유: clearTokens만 부르면 sessionStorage의 세션 소유자 id가 로그아웃 후에도 남아,
    //       다음 계정으로 로그인한 세션이 첫 refresh에서 강제 로그아웃됐다 (session-guard.ts).
    // 방법: /auth/signout으로 서버 앵커를 지우고(실패해도 진행), clearTokens + clearSessionUser로
    //       로컬 흔적을 모두 비운 뒤 로그인 화면으로 이동한다.
    const signOut = async () => {
        try {
            await api.post('/auth/signout');
        } catch {
            // 최선을 다해 시도할 뿐, 실패해도 계속 진행한다
        } finally {
            clearTokens();
            clearSessionUser();
            navigate('/');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold dark:text-gray-100">Users</h1>
                    <div className="flex gap-3 items-center">
                        <button
                            onClick={() => navigate('/dashboard')}
                            data-testid="nav-dashboard"
                            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                            Dashboard
                        </button>
                        <button
                            onClick={() => navigate('/logs')}
                            data-testid="nav-logs"
                            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                            Logs
                        </button>
                        <ThemeToggle />
                        <button
                            onClick={signOut}
                            data-testid="sign-out-button"
                            className="text-sm text-red-600 hover:underline dark:text-red-400"
                        >
                            Sign out
                        </button>
                    </div>
                </div>

                {actionMsg && (
                    <p data-testid="action-message" className="mb-4 text-sm text-blue-700 bg-blue-50 rounded px-3 py-2 dark:text-blue-200 dark:bg-blue-900">{actionMsg}</p>
                )}

                <div className="mb-4">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search by email..."
                        data-testid="user-search-input"
                        className="w-full max-w-sm text-sm border rounded px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
                    />
                </div>

                {loading ? (
                    <p className="text-gray-500 dark:text-gray-400">Loading...</p>
                ) : (
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto" tabIndex={0}>
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 dark:bg-gray-700 text-left dark:text-gray-200">
                                <tr>
                                    {(['id', 'email', 'createdAt'] as SortField[]).map((field) => (
                                        <th
                                            key={field}
                                            onClick={() => toggleSort(field)}
                                            data-testid={`user-sort-${field}`}
                                            className="px-4 py-3 cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-600"
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
                                        className={`border-t dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200${selectedUser?.id === u.id ? ' bg-blue-50 dark:bg-blue-900' : ''}`}
                                    >
                                        <td className="px-4 py-3">{u.id}</td>
                                        <td className="px-4 py-3">{u.email}</td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
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
                                                    className="text-xs border rounded px-1 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
                                                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800"
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
                        className="absolute right-0 top-0 h-full w-96 bg-white dark:bg-gray-800 shadow-2xl overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                        data-testid="user-detail-panel"
                    >
                        <div className="flex justify-between items-center px-5 py-4 border-b dark:border-gray-700">
                            <h2 className="font-semibold text-gray-800 dark:text-gray-100">User Detail</h2>
                            <button
                                onClick={() => setSelectedUser(null)}
                                data-testid="panel-close"
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="px-5 py-4 space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">ID</span>
                                <span className="font-mono dark:text-gray-200">{selectedUser.id}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Email</span>
                                <span className="truncate max-w-48 dark:text-gray-200">{selectedUser.email}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-500 dark:text-gray-400">Role</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[selectedUser.role]}`}>
                                    {ROLE_LABEL[selectedUser.role]}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Joined</span>
                                <span className="text-gray-600 dark:text-gray-300">{new Date(selectedUser.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Updated</span>
                                <span className="text-gray-600 dark:text-gray-300">{new Date(selectedUser.updatedAt).toLocaleString()}</span>
                            </div>
                        </div>

                        <div className="border-t dark:border-gray-700 px-5 py-4">
                            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Recent activity</h3>
                            {recentActivityLoading ? (
                                <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
                            ) : recentActivity.length === 0 ? (
                                <p className="text-sm text-gray-400 dark:text-gray-500">No activity yet.</p>
                            ) : (
                                <ul data-testid="recent-activity-list" className="space-y-2">
                                    {recentActivity.map((log) => (
                                        <li key={log.id} data-testid={`recent-activity-${log.id}`} className="text-sm">
                                            <div className="flex items-center justify-between">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                                <span className="text-gray-400 dark:text-gray-500 text-xs">
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            {/* The target was omitted while a row's target kind could only be
                                                guessed from its action; the server now names it (ADR 0045), so
                                                the panel can show which file/post/comment an entry was about
                                                instead of leaving `detail` as the only clue. */}
                                            <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
                                                Target: {targetLabel(log.targetType, log.targetId)}
                                            </p>
                                            {log.detail && (
                                                <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">{log.detail}</p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <button
                                onClick={() => navigate(`/logs?userId=${selectedUser.id}`)}
                                data-testid="recent-activity-view-all"
                                className="mt-3 text-sm text-blue-600 hover:underline dark:text-blue-400"
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
