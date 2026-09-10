import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import api from '../api/axios';
import { useAuthStore, type UserRole } from '../store/auth.store';
import { ROLE_RANK } from '../auth/role';
import { recordSessionUser } from '../auth/session-guard';
import { useState } from 'react';
import ThemeToggle from '../components/theme-toggle';

interface LoginForm {
    email: string;
    password: string;
}

function LoginPage() {
    const { register, handleSubmit } = useForm<LoginForm>();
    const { setTokens } = useAuthStore();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    // 목적: Basic 자격증명으로 사인인하고, 이 탭의 세션 소유 계정을 확정한다.
    // 이유: setTokens만 부르면 sessionStorage의 소유자 id가 이전 계정으로 남아, 다음 refresh가
    //       계정 불일치로 오판되어 정상 세션이 강제 로그아웃됐다 (session-guard.ts assertSessionUser).
    // 방법: 액세스 토큰의 role을 검사해 admin 미만이면 중단하고, 통과 시 setTokens 직후
    //       recordSessionUser(sub)로 소유자를 새로 기록한 뒤 /dashboard로 이동한다.
    const onSubmit = async (data: LoginForm) => {
        setError('');
        try {
            const base64 = btoa(`${data.email}:${data.password}`);
            const res = await api.post('/auth/signin', null, {
                headers: { Authorization: `Basic ${base64}` },
            });
            const { sub, role } = jwtDecode<{ sub: number; role?: UserRole }>(res.data.accessToken);
            if (!role || ROLE_RANK[role] < ROLE_RANK.admin) {
                setError('Admin access only.');
                return;
            }
            setTokens(res.data.accessToken, sub, role);
            recordSessionUser(sub);
            navigate('/dashboard');
        } catch {
            setError('Invalid credentials.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow w-80 flex flex-col gap-4"
            >
                <h1 className="text-xl font-bold text-center dark:text-gray-100">Admin Login</h1>
                {error && <p data-testid="login-error" className="text-red-500 dark:text-red-400 text-sm text-center">{error}</p>}
                <input
                    {...register('email', { required: true })}
                    type="email"
                    placeholder="Email"
                    data-testid="login-email-input"
                    className="border rounded px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                />
                <input
                    {...register('password', { required: true })}
                    type="password"
                    placeholder="Password"
                    data-testid="login-password-input"
                    className="border rounded px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                />
                <button
                    type="submit"
                    data-testid="login-submit-button"
                    className="bg-blue-600 text-white rounded py-2 text-sm font-semibold hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
                >
                    Sign In
                </button>
            </form>
        </div>
    );
}

export default LoginPage;
