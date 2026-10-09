# 고스톱 / 맞고

React + TypeScript + Vite 기반 화투 게임입니다. 기존 2인 맞고·3인 고스톱 AI 모드와 온라인 2인 맞고·3인 고스톱을 제공합니다.

온라인 개발 실행은 터미널 두 개에서 각각 `npm run dev:server`, `npm run dev`를 실행한 뒤, 2개 또는 3개 브라우저에서 **온라인 2인 맞고 / 3인 고스톱**으로 접속합니다. 닉네임을 입력하고 방 생성 또는 6자리 코드 참가 후, 정원 모두가 준비하면 방장이 게임을 시작합니다.

서버 구조와 규칙은 [온라인 맞고 문서](docs/online-matgo.md)와 [온라인 3인 고스톱 문서](docs/online-gostop.md), 현재 시작 절차는 [대기실 문서](docs/online-lobby.md)를 참고하세요. 새로고침·일시적 연결 종료는 같은 서버 프로세스에서 60초 유예 동안 좌석을 복구합니다. 자세한 정책은 [재접속 문서](docs/online-reconnect.md), production 환경변수와 빌드·배포는 [배포 문서](docs/deployment.md)에 정리했습니다.

## Vite 템플릿 참고

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
