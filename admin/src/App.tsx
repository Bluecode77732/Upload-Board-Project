import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/protected-route';
import LoginPage from './pages/login-page';
import DashboardPage from './pages/dashboard-page';
import UsersPage from './pages/users-page';
import LogsPage from './pages/logs-page';

function App() {
    return (
        <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
                <Route path='/' element={<LoginPage />} />
                <Route path='/dashboard' element={
                    <ProtectedRoute>
                        <DashboardPage />
                    </ProtectedRoute>
                } />
                <Route path='/users' element={
                    <ProtectedRoute>
                        <UsersPage />
                    </ProtectedRoute>
                } />
                <Route path='/logs' element={
                    <ProtectedRoute>
                        <LogsPage />
                    </ProtectedRoute>
                } />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
