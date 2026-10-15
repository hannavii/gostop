# 온라인 Playwright E2E

## 테스트 계층

기존 `test:online`은 Node test runner로 서버, Socket.IO integration, 공개 상태,
온라인 UI/presentation을 검증한다. `tests/pansseul.test.mjs`는 기존 규칙 회귀 테스트다.
기존 `browser-reconnect.mjs`, `mobile-browser-checks.mjs`, `browser-rematch-checks.mjs`는
설치된 Edge를 CDP로 조작하며 유지한다. `online-layout-fixture.tsx`는 복잡한 모바일
표시 상태를 렌더하는 전용 fixture이며 실제 멀티플레이 서버 E2E를 대체하지 않는다.

새 `tests/e2e`는 실제 UI와 실제 Socket.IO 서버 사이의 Playwright E2E 계층이다.
Playwright의 독립 BrowserContext, locator 자동 대기, polling assertion을 사용한다.
별도 브라우저 RPC/프로필 관리 코드를 추가할 필요가 없어 기존 CDP 스크립트를
확장하는 것보다 신규 시나리오와 CI 실행 관리에 적합하다.

## 실행

Node 24 이상에서 최초 설치:

```sh
npm ci
npm run test:e2e:install
```

전체 E2E는 한 명령으로 실행한다. 서버를 미리 실행하거나 .env를 설정할 필요가 없다.

```sh
npm run test:e2e
```

부분 실행과 타입 검사:

```sh
npm run test:e2e -- --project=desktop
npm run test:e2e -- --grep="countdown"
npm run typecheck:e2e
```

기본은 Playwright가 설치하는 Chromium이다. 설치된 Edge를 사용하려면 실행 셸에
`E2E_BROWSER_CHANNEL=msedge`를 설정한다. 이는 브라우저 실행 선택이며 게임 설정이 아니다.

## 격리와 수명

각 테스트는 자체 메모리 서버와 Vite를 127.0.0.1의 OS 할당 포트에서 시작한다.
별도 프로세스나 고정 포트, 외부 사이트, DB, Redis를 사용하지 않는다.
Vite는 테스트에서 만든 Socket.IO 서버로 proxy하고 개발자의 .env를 읽지 않는다.
각 좌석은 별도 BrowserContext를 사용한다. 종료 시 컨텍스트, Socket.IO, Vite를 정리한다.
기본 workers=2, retries=0이며 CLI에서 workers를 조절할 수 있다.

서버에는 기존 matchFactory와 같은 방식의 turnTimerFactory 주입 지점만 추가했다.
제한시간 2.5초와 고정 패 코드는 `tests/e2e/fixtures.ts`에만 존재한다.
운영 `server/index.ts`는 주입 옵션을 사용하지 않으며 기본 제한시간은 계속 30초다.
환경변수·HTTP·Socket 이벤트·클라이언트 입력으로 제한시간이나 fixture를 선택할 수 없다.

## 시나리오

모든 시나리오는 2인 맞고와 3인 고스톱, 1440×900 / 360×800 / 390×844에서 실행한다.

- 방 생성/코드 참가/준비/방장 시작, 자기 손패와 상대 뒷면, 공개 wire 상태의 손패 격리
- F5 후 token 기반 자동 복구, 좌석·닉네임·게임 상태 유지, 실제 카드 제출 후 좌석 순서
- 실제 제출 중 flying card가 최종 손패·바닥패·먹은 패에 중복 존재하지 않는지 관찰
- 서버 GO/STOP fixture에서 STOP으로 실제 게임 종료, 한 명 동의 시 대기, 전원 동의 시
  같은 방의 새 Match, 좌석·닉네임 유지, 점수/카운터/선택/결과 초기화 및 새 판 플레이
- countdown, active player의 페이지 이탈로 실제 연결 종료, 기존 deadline을 지난 뒤에도
  자동 행동 없음, 같은 탭 복귀 후 새 deadline, 만료 시 서버 자동 행동과 다음 좌석
- 대기실/게임/정산 및 재대결 화면에서 document 가로 overflow와 주요 영역 viewport 이탈 검사

초기 패는 모든 카드가 중복 없이 존재하도록 고정하여 첫 턴의 랜덤 매칭과 점수로
테스트 흐름이 달라지지 않게 한다. 게임 규칙은 실제 서버 엔진을 그대로 사용한다.
임의 sleep 대신 DOM, room:state revision/seat/connection, 실제 deadline 경과를 기다린다.

## Selector와 보안

추가 selector는 온라인 보드의 `data-testid="online-board"`, 자기 손패의
`data-testid="own-hand"` 및 보드의 공개 seat/turn/revision/round 속성뿐이다.
나머지는 접근성 label/role과 기존 카드/animation 영역 class를 사용한다.

네트워크 관찰기는 room:state만 보관하고 room:session은 보관하지 않는다.
reconnect token은 페이지 안에서 SHA-256으로 요약해 동일성만 확인한다.
assertion 실패에도 전체 private state/token을 출력하지 않도록 boolean 검사를 사용한다.
trace, video, screenshot, storageState 파일 저장은 기본 비활성화한다.
test-results와 playwright-report는 gitignore에 포함한다. 네트워크 trace를 수동 활성화하면
재접속 자격증명이 기록될 수 있으므로 해당 산출물을 공유하거나 커밋하지 않는다.

## CI 준비와 범위

현재 저장소에 GitHub Actions workflow가 없어 새 CI 전체 구성은 추가하지 않았다.
향후 CI에서 Node 24 설정 → npm ci → npx playwright install --with-deps chromium →
npm run test:e2e 순서로 실행할 수 있다. 별도 서버 서비스 설정은 필요 없다.

이번 E2E는 Chromium 계열 중심이다. Firefox/WebKit, 실제 모바일 기기,
운영 배포/CORS·장시간 네트워크 불안정, 모든 특수패 조합, 60초 grace 만료의 브라우저
전체 흐름은 별도 범위다. 기본 30초 경계·matching·GO/STOP timeout·stale callback과
grace/rematch 세부 정책은 기존 unit/integration 테스트로 계속 검증한다.
