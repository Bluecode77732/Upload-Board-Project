// 목적: LanguageProvider 밖에서 쓰이면 에러를 던지는, 타입이 있는 언어 컨텍스트 접근자.
// 사용처: provider 하위 어떤 컴포넌트에서든 const { t, language, toggleLanguage } = useLanguage()로 사용.
// 근거: 별도 파일로 분리해야 fast-refresh 경계가 깨끗하게 유지된다(hook과 provider 컴포넌트
//   분리) — src/theme/useTheme.ts, src/auth/useAuth.ts와 동일한 패턴.

import { useContext } from 'react'
import { LanguageContext } from './languageContext'

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be used within a LanguageProvider')
  return value
}
