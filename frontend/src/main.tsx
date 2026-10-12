// 목적: 앱의 진입점 — 폰트와 전역 CSS를 불러오고 Provider들을 감싸 #root에 App을 그린다.
// 사용처: index.html의 <script type="module">이 불러온다; 다른 모듈은 임포트하지 않는다.
// 근거: Provider 순서(Theme → Language → Router → Auth)와 self-host 폰트 임포트를 한곳에 고정한다.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/noto-sans-kr'
import '@fontsource-variable/hahmlet'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { LanguageProvider } from './i18n/LanguageProvider.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
)
