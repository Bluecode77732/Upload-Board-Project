import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement matchMedia (https://github.com/jsdom/jsdom/issues/2985) —
// theme.store.ts calls it at module load to resolve the OS-preferred theme, which otherwise
// throws as soon as any spec imports a page that pulls in theme-toggle.tsx.
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
