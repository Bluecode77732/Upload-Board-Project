import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useEffect, useState } from 'react';
import { refreshAccessTokenSafely } from '../auth/session-guard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { accessToken, role } = useAuthStore();
    const [initializing, setInitializing] = useState(!accessToken);

    useEffect(() => {
        if (!accessToken) {
            refreshAccessTokenSafely().finally(() => setInitializing(false));
        }
    }, []);

    if (initializing) return null;

    if (!accessToken || (role ?? -1) < 1) {
        return <Navigate to='/' replace />;
    }

    return <>{children}</>;
}

export default ProtectedRoute;
