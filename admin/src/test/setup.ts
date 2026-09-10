import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom은 matchMedia를 구현하지 않는다 (https://github.com/jsdom/jsdom/issues/2985) —
// theme.store.ts가 모듈 로드 시점에 OS 선호 테마를 판단하려고 이를 호출하는데, 폴리필이
// 없으면 theme-toggle.tsx를 불러오는 페이지를 import하는 spec에서 즉시 예외가 발생한다.
if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => {
    cleanup();
});
