// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // `const { password, ...rest } = user`로 걸러내는 패턴은 의도된 것이다
      // (jwt.strategy.ts) — 버려지는 나머지가 실수가 아니라 목적 그 자체다.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // Jest mock은 jest.fn()들로 이뤄진 평범한 객체다 — 그 메서드를 unbound 상태로
    // expect()에 넘겨도 안전하고, 이 프로젝트 spec에서 이미 확립된 패턴이다.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // e2e 전용: supertest가 `res.body`와 `getHttpServer()`를 `any`로 타입 지정하기
    // 때문에, unsafe-* 계열 경고는 여기선 피할 수 없는 노이즈다 — 안전성은 컴파일
    // 타임 타입이 아니라 런타임 assertion에서 나온다. test/로 범위를 좁혀서
    // unit spec의 엄격함은 그대로 유지한다.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);