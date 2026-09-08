import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Imported for its module-load side effect (applies the resolved theme to documentElement
// before the first paint) — must run before App renders, or the page flashes light first.
import './store/theme.store';
import App from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
