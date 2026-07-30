import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import api from '../api/axios';
import { useAuthStore } from '../store/auth.store';
import { useState } from 'react';

interface LoginForm {
    email: string;
    password: string;
}

function LoginPage() {
    const { register, handleSubmit } = useForm<LoginForm>();
    const { setTokens } = useAuthStore();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    const onSubmit = async (data: LoginForm) => {
        setError('');
        try {
            const base64 = btoa(`${data.email}:${data.password}`);
            const res = await api.post('/auth/signin', null, {
                headers: { Authorization: `Basic ${base64}` },
            });
            const { sub, role } = jwtDecode<{ sub: number; role: number }>(res.data.accessToken);
            if (role < 1) {
                setError('Admin access only.');
                return;
            }
            setTokens(res.data.accessToken, sub, role);
            navigate('/dashboard');
        } catch {
            setError('Invalid credentials.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="bg-white p-8 rounded-xl shadow w-80 flex flex-col gap-4"
            >
                <h1 className="text-xl font-bold text-center">Admin Login</h1>
                {error && <p data-testid="login-error" className="text-red-500 text-sm text-center">{error}</p>}
                <input
                    {...register('email', { required: true })}
                    type="email"
                    placeholder="Email"
                    data-testid="login-email-input"
                    className="border rounded px-3 py-2 text-sm"
                />
                <input
                    {...register('password', { required: true })}
                    type="password"
                    placeholder="Password"
                    data-testid="login-password-input"
                    className="border rounded px-3 py-2 text-sm"
                />
                <button
                    type="submit"
                    data-testid="login-submit-button"
                    className="bg-blue-600 text-white rounded py-2 text-sm font-semibold hover:bg-blue-700"
                >
                    Sign In
                </button>
            </form>
        </div>
    );
}

export default LoginPage;
