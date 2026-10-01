// 목적: 한/영 언어 선택을 위한 React 컨텍스트 객체 + 공유 타입(provider와 분리해 둬야 Vite
//   fast-refresh가 정상 동작한다 — 컴포넌트를 export하는 파일이 컨텍스트/hook까지 export하면 안 된다).
// 사용처: LanguageProvider가 값을 공급하고, useLanguage(별도 파일)가 소비한다.
// 근거: 컨텍스트/provider/hook을 파일별로 나누는 것은 src/auth/와 src/theme/에서 이미 쓰고 있는
//   fast-refresh 안전 규칙이다 — 언어 선택도 테마 선택과 같은 모양(저장된 값 + 토글)이라 그대로 따른다.

import { createContext } from 'react'
import type { MessageParams, Translatable } from './messages'

export type Language = 'en' | 'ko'

export interface LanguageContextValue {
  language: Language
  toggleLanguage: () => void
  // 키(또는 키+치환값, 서버가 준 raw 문구)를 현재 언어의 문자열로 바꾼다.
  t: (message: Translatable, params?: MessageParams) => string
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)
