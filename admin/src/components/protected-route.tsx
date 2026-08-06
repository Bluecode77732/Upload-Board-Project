import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useEffect, useState } from 'react';
import { refreshAccessTokenSafely } from '../auth/session-guard';
import { ROLE_RANK } from '../auth/role';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { accessToken, role } = useAuthStore();
    const [initializing, setInitializing] = useState(!accessToken);

    useEffect(() => {
        if (!accessToken) {
            refreshAccessTokenSafely().finally(() => setInitializing(false));
        }
    }, []);

    if (initializing) return null;

    if (!accessToken || role === null || ROLE_RANK[role] < ROLE_RANK.admin) {
        return <Navigate to='/' replace />;
    }

    return <>{children}</>;
}

export default ProtectedRoute;
