import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/protected-route';
import LoginPage from './pages/login-page';
import DashboardPage from './pages/dashboard-page';
import UsersPage from './pages/users-page';
import RoomsPage from './pages/rooms-page';
import LogsPage from './pages/logs-page';

function App() {
    return (
        <BrowserRouter>
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
                <Route path='/rooms' element={
                    <ProtectedRoute>
                        <RoomsPage />
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
