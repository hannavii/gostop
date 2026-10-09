# 배포 준비

Node.js 24 이상과 npm을 사용한다. 특정 호스팅 서비스나 계정 연결 없이 정적 프론트와 Node 서버를 각각 실행하는 구조다. 게임 엔진, 온라인 이벤트/룰, 개인 손패 projection, 재접속 토큰은 유지한다.

## 환경변수

루트 `.env.example`을 참고한다. `.env`, `.env.*`는 Git에서 제외하며 `.env.example`만 추적한다. 실제 비밀값은 예시 파일에 넣지 않는다.

| 변수 | 적용 시점 | 기본값 / 설정 |
| --- | --- | --- |
| `VITE_SOCKET_URL` | 프론트 **빌드 시점** | 비어 있으면 현재 페이지 origin. 분리 배포 시 `https://api.example.com`처럼 서버의 HTTP(S) origin 지정. `/socket.io` 경로를 붙이지 않는다. |
| `NODE_ENV` | 서버 실행 시점 | 로컬에서는 생략. 운영 서버는 반드시 `production`. |
| `PORT` | 서버 실행 시점 | `3001`. 호스팅에서 주입한 값 우선. 1~65535 정수만 허용. |
| `HOST` | 서버 실행 시점 | 개발 `127.0.0.1`, production `0.0.0.0`. 필요하면 명시적으로 변경. |
| `ALLOWED_ORIGINS` | 서버 실행 시점 | 개발 `http://localhost:5173,http://127.0.0.1:5173`. production에서는 필수. 예: `https://play.example.com,https://www.example.com`. |
| `DEV_SOCKET_PROXY_TARGET` | Vite 개발 서버 시작 시점 | `http://127.0.0.1:<PORT 또는 3001>`. 별도 로컬 서버를 쓰는 경우에만 지정. |

허용 origin에는 스킴·호스트·필요한 포트만 넣고, 후행 `/`, 경로, 와일드카드, 빈 항목은 넣지 않는다. production에서 목록을 누락하거나 잘못 지정하면 서버는 시작하지 않는다. 개발 허용 origin은 production에 자동으로 추가되지 않는다.

`VITE_` 변수는 브라우저 번들에 공개된다. 서버 secret이나 재접속 토큰을 넣으면 안 된다. `VITE_SOCKET_URL`을 바꾸면 프론트를 다시 빌드해야 한다. 서버 런타임 값만 바꿔도 기존 프론트 번들의 주소는 바뀌지 않는다. [Vite 환경변수 문서](https://vite.dev/guide/env-and-mode)

서버 명령은 Node의 `--env-file-if-exists=.env`로 루트 `.env`를 읽는다. 운영 플랫폼이 주입한 환경변수가 파일보다 우선하며 파일이 없어도 실행된다. 서버는 Vite의 `.env.production`/`.env.local`을 자동으로 읽지 않는다. 프론트는 Vite의 표준 환경변수 파일 규칙을 사용한다. [Node 환경변수 파일 옵션](https://nodejs.org/api/cli.html#--env-file-if-existsfile)

## 로컬 개발

```sh
npm ci
```

터미널 1:

```sh
npm run dev:server
```

터미널 2:

```sh
npm run dev
```

별도 `.env` 없이 `http://localhost:5173` 또는 `http://127.0.0.1:5173`에서 실행한다. `VITE_SOCKET_URL`이 비어 있으면 `/socket.io` 요청을 Vite가 로컬 서버로 프록시한다. 개발 포트는 5173으로 고정하며 사용 중이면 명확히 실패한다. 다른 프론트 포트/LAN 주소를 쓸 때는 `ALLOWED_ORIGINS`도 변경한다. 서버 `PORT`를 바꾸면 Vite를 재시작해 proxy 설정을 반영한다.

## Production 빌드와 서버 시작

프론트 빌드 환경에 실제 `VITE_SOCKET_URL`을 설정한 뒤:

```sh
npm ci --include=dev
npm run build
```

빌드 도구는 빌드 단계에 필요하다. 결과물은 다음과 같다.

```text
dist/
  client/             # 정적 프론트 배포 루트
    index.html
    assets/
  server/
    index.mjs         # Node가 실행하는 서버 번들
```

프론트만 빌드하려면 `npm run build:client`, 서버만 빌드하려면 `npm run build:server`를 사용한다. 각 빌드는 다른 쪽 결과물을 지우지 않는다. 이전 버전의 `dist/index.html`이 남아 있어도 **정적 배포 루트는 반드시 `dist/client`**로 지정한다.

운영 런타임에는 `package.json`, `package-lock.json`, `dist/server`가 필요하다. 별도 런타임 디렉터리에서:

```sh
npm ci --omit=dev
npm run start:server
```

같은 디렉터리에서 빌드와 실행을 모두 한다면 빌드 후 `npm prune --omit=dev`로 개발 의존성을 제거해도 된다. 서버는 esbuild 결과인 `dist/server/index.mjs`를 Node로 실행하며 tsx/TypeScript가 필요 없다. Express와 Socket.IO 등 런타임 의존성은 `node_modules`에 있어야 한다. `npm start`도 같은 서버 명령의 별칭이다. 운영 실행 환경에는 먼저 다음 값을 설정한다.

```dotenv
NODE_ENV=production
ALLOWED_ORIGINS=https://play.example.com
# PORT는 플랫폼 주입값을 사용하거나 직접 지정
# HOST는 기본값 0.0.0.0 사용 가능
```

`GET /health`는 인증 없이 HTTP 200과 `{"ok":true}`만 반환한다. 방·플레이어·토큰을 노출하지 않는다. 종료 신호 SIGINT/SIGTERM은 기존 서버 종료 경로를 사용한다.

## 프론트와 서버를 각각 배포할 때

1. 프론트 빌드 환경에 `VITE_SOCKET_URL=https://api.example.com` 설정 후 빌드하고 `dist/client`를 정적 호스팅에 올린다.
2. 서버 실행 환경에 `NODE_ENV=production`, `ALLOWED_ORIGINS=https://play.example.com`과 필요한 `PORT`/`HOST`를 설정한다.
3. 서버의 `/socket.io/`에 HTTP GET/POST polling과 WebSocket Upgrade를 모두 전달한다. Socket.IO 기본 경로를 임의로 바꾸지 않는다. HTTPS 프론트는 HTTPS 서버 URL을 사용한다.
4. 프록시가 `Origin`을 원본 그대로 전달하도록 하고, 연결 idle timeout은 Socket.IO 기본 ping interval + timeout(45초)보다 길게 설정한다. 예: 75초 이상. health check 경로는 `/health`다.

서버는 프론트 정적 파일을 제공하지 않는다. Vite 개발 proxy가 없는 정적 배포에서도 공개 서버 URL로 직접 연결한다. Vite preview는 로컬 확인용이며 운영 서버 명령이 아니다.

동일 origin을 원하면 외부 reverse proxy에서 프론트 정적 파일과 `/socket.io/`를 함께 라우팅하고 `VITE_SOCKET_URL`을 비워 둔다. 이때도 프론트 origin을 `ALLOWED_ORIGINS`에 넣는다. 같은 origin의 polling GET은 Origin 헤더를 생략할 수 있으므로, 서버는 `Sec-Fetch-Site: same-origin`인 경우 허용된 Referer origin을 확인한다. 이 구성에서는 Referer를 완전히 제거하는 정책을 쓰지 않고 프록시가 두 헤더를 보존해야 한다.

production은 허용하지 않은 origin, `Origin: null`, origin과 검증 가능한 same-origin Referer가 모두 없는 Socket.IO handshake를 거부한다. `/health`는 이 제한과 무관하다. CORS는 polling에 적용하고 `allowRequest`로 WebSocket handshake도 검사한다. Origin 검사는 브라우저 경계이며 직접 작성한 클라이언트의 인증을 대신하지 않는다. 기존 재접속 토큰 검증을 유지한다. 쿠키 기반 로그인은 사용하지 않으므로 `withCredentials`를 추가하지 않는다. [Socket.IO CORS 문서](https://socket.io/docs/v4/handling-cors/)

## 현재 운영 제약

방과 토큰 해시는 단일 서버 프로세스 메모리에 있다. **서버 인스턴스/worker는 1개**로 운영하고 다중 인스턴스 자동 확장이나 cluster 모드는 사용하지 않는다. 서버 재시작·재배포·인스턴스 교체 시 기존 방과 재접속 정보가 사라진다. 60초 grace는 같은 프로세스가 살아 있을 때의 일시적 연결 끊김을 복구하는 정책이다. DB/Redis/로그인 및 프로세스 간 상태 복제는 이번 범위에 포함하지 않았다.

## 검증

```sh
npm run test:online
node --test tests/pansseul.test.mjs
npm run typecheck
npm run build
npm run test:browser-reconnect
npm run test:browser-reconnect -- --production
```

브라우저 테스트는 로컬 Edge 또는 `BROWSER_EXECUTABLE`로 지정한 Chromium을 사용한다. production 옵션은 실제 Vite 빌드에 서버 URL을 넣고 proxy 없는 별도 origin의 정적 preview에서 2인/3인 대기실·게임·F5·네트워크 복구·손패 보호를 검증한다. 계정 연결이나 외부 배포는 하지 않는다.
