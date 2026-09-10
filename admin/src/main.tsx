import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// 모듈 로드 시 부수 효과(첫 페인트 전에 documentElement에 결정된 테마를 적용)를 위해
// import한다 — App이 렌더링되기 전에 실행되어야 하며, 그렇지 않으면 화면이 잠깐 밝게 보인다.
import './store/theme.store';
import App from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
