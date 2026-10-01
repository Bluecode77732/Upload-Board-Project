// 목적: 선택한 언어(en/ko)를 소유한다 — localStorage에 저장하고, <html lang>에 반영하며, 현재 언어의
//   사전으로 키를 문자열로 바꿔 주는 t()를 공급한다.
// 사용처: main.tsx에서 앱을 한 번 감싸고, 자식들은 useLanguage로 읽고/토글한다.
// 근거: ThemeProvider와 같은 구조(저장된 선택 + 토글)다. 저장된 값이 없으면 영어로 시작한다 —
//   브라우저 언어를 추측해 바꾸면 e2e와 첫 방문 화면이 환경마다 달라지기 때문이다.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LanguageContext, type Language } from './languageContext'
import { en, ko, type MessageKey, type MessageParams, type Translatable } from './messages'

const STORAGE_KEY = 'ui-lang'

const DICTIONARY: Record<Language, Record<MessageKey, string>> = { en, ko }

function storedLanguage(): Language {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'en' || value === 'ko' ? value : 'en'
}

// `{name}` 자리표시자를 params의 값으로 채운다. 값이 없는 자리표시자는 그대로 둔다.
function format(template: string, params: MessageParams | undefined): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => storedLanguage())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === 'en' ? 'ko' : 'en'))
  }, [])

  const t = useCallback(
    (message: Translatable, params?: MessageParams) => {
      if (typeof message === 'object' && 'raw' in message) return message.raw
      const key = typeof message === 'string' ? message : message.key
      const values = typeof message === 'string' ? params : message.params
      return format(DICTIONARY[language][key], values)
    },
    [language],
  )

  const value = useMemo(() => ({ language, toggleLanguage, t }), [language, toggleLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
