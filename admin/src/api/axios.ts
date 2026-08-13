import axios from 'axios';
import { useAuthStore } from '../store/auth.store';
import { refreshAccessTokenSafely } from '../auth/session-guard';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    withCredentials: true,
});

api.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken;
    if (token && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;

        if (error.response?.status === 401 && !original._retry) {
            original._retry = true;

            const accessToken = await refreshAccessTokenSafely();
            if (!accessToken) return Promise.reject(error);

            original.headers.Authorization = `Bearer ${accessToken}`;
            return api(original);
        }

        return Promise.reject(error);
    },
);

export default api;
