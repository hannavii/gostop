# 온라인 3인 고스톱 MVP

## 기존 구조와 확장 방식

- `server/app.ts`의 Socket.IO 연결 신원, 방 코드, 입장/퇴장, acknowledgement와 상태 재전송을 두 모드가 공유한다. 방에 `mode`를 저장하고 `GAME_RULES[mode].playerCount`로 정원과 시작 시점을 결정한다.
- `server/game.ts`의 원자적 상태 전이, revision, 손패/더미 선택, 폭탄/흔들기, GO/STOP 흐름을 공유한다. 서버의 복사본에 행동을 적용하고 성공했을 때만 방 상태를 교체한다.
- `server/turnEngine.ts`는 기존 `turn.ts`와 `gostopTurn.ts`를 호출하는 작은 어댑터다. 2인 엔진의 `player/opponent` 이름만 온라인 절대 좌석 `0/1`로 변환한다. 3인은 `gostopTurn.ts`를 직접 호출한다. 싱글플레이 규칙 파일은 수정하지 않았다.
- `GostopGame.tsx`는 세 손패와 AI, 타이머를 직접 소유하므로 온라인에서 실행하지 않는다. 기존 녹색 게임판 CSS와 상대 2명 배치, 3개 먹은 패 패널, 카드/더미, 확대창 및 정산 표시 스타일을 재사용한다.
- `OnlineMatgo.tsx`는 기존 파일명을 유지한 공통 로비/연결 화면이다. `OnlineGameBoard.tsx`도 두 모드가 공유한다. 모드별 차이는 상대 인원·패널 위치·정산 표시뿐이며, 서버 규칙 코드를 브라우저에 import하지 않는다.

## 서버와 공개 상태

| 상태 | 내용 |
| --- | --- |
| Room | code, mode, members(Socket.IO ID 배열), match |
| Match | mode, revision, turn, phase, players, floor, pile, pending, revealed, events, ppeokStacks, result |
| 비공개 Player | hand, captured, goCount, lastGoScore, bombCount, bombPassCount, shakeMonths |
| RoomView | code, mode, capacity, you, occupancy, game |
| GameView | 자기 hand, 공개 players(장수·획득패·점수·GO·폭탄·흔들기 기록), floor, drawCount, turn, phase, revision, 공개 이벤트와 결과 |

`Seat`와 뻑 소유자 `owner`는 절대 좌석 `0 | 1 | 2`다. UI의 상대 1은 `(you + 1) % 3`, 상대 2는 `(you + 2) % 3`으로 표시한다. 뻑 소유자와 정산 부담자도 같은 기준으로 이름을 변환한다.

`gameView`는 전송 필드를 명시적으로 선택하고 깊은 복사본을 반환한다. 다른 두 손패와 더미 실제 카드, pending, lastGoScore는 전송하지 않는다. 손패 특수 행동 후보 `specialOptions`와 바닥 선택 `choice`는 행동자에게만 전송한다. 클라이언트는 후보를 계산하지 않고 서버 후보에 따라 선택창을 연다. 흔들기는 월과 횟수만 공개하며 남은 손패 ID를 노출하지 않는다.

## 이벤트

추가 이벤트는 **`room:create-mode(mode, ack)`** 하나다. mode는 `matgo` 또는 `gostop`이며 런타임에서 검증한다. 기존 **`room:create(ack)`**는 2인 맞고 생성으로 유지한다.

`room:join`, `room:leave`, `room:sync`, `game:action`, `room:state`, `room:closed`는 공통으로 사용한다. `game:action`의 행동은 기존과 같은 `play / choose / bomb / shake / bomb-pass / go / stop`이다. 정원, 턴, 카드 소유권, 단계, revision은 서버가 검증하며 클라이언트가 모드·좌석·점수를 행동 요청에 끼워 넣으면 거부한다.

3인 방은 1명 또는 2명일 때 `game: null`이다. 세 번째 플레이어가 참가할 때만 서버가 분배한다. 네 번째 참가자는 거부한다. 어떤 참가자든 연결이 끊기거나 나가면 방을 닫고 나머지 모두에게 알린다.

## 3인 규칙과 정산

- 기존 `dealGostopCards`로 손패 7장씩, 바닥 6장, 더미 21장을 분배한다.
- 턴은 `0 → 1 → 2 → 0`이다. 바닥패 선택과 GO/STOP 중에는 같은 행동자의 턴을 유지한다.
- `gostopTurn.ts`의 뻑·쪽·따닥·뻑 회수·판쓸·폭탄/흔들기 후보·더미 전용 처리를 사용한다. 피 보상은 다른 두 플레이어 각각에게 적용한다. 부족한 피와 쌍피 처리는 기존 함수에 맡긴다.
- 폭탄은 3장 내기와 바닥 1장 획득, 각 상대 피 보상, 더미 1장 뒤집기, 패스 2회 생성으로 처리한다. 판쓸은 더미/선택까지 완성된 턴에만 한 번 적용한다. 손패와 남은 패스를 합쳐 마지막 턴 보상과 나가리를 판정한다.
- 흔들기/폭탄 대신 일반 한 장 내기를 선택할 수 있다. 패스는 자기 일반 턴에 사용할 수 있다. 같은 월 흔들기의 중복 선언을 서버가 거부한다.
- 3점 이상이면서 지난 GO 점수보다 증가한 경우 GO/STOP을 연다. STOP은 `calculateGostopSettlement`를 호출하고 `result.gostopSettlement`에 원본 결과를 담는다. 2인은 기존 `result.settlement`를 사용한다.
- 고박 대납, 패자별 광박/피박, 승자 GO·흔들기·폭탄 배수는 기존 정산을 유지한다. 기존 함수의 제한도 유지한다: 패자 두 명 모두 GO한 경우에는 마지막 GO 순서가 없으므로 대납을 적용하지 않는다.

## 실행과 검증

```sh
npm run dev:server
npm run dev
```

브라우저 3개에서 동일한 Vite 주소에 접속한다. 첫 화면의 **온라인 2인 맞고 / 3인 고스톱**에서 A가 **3인 고스톱**을 선택하고 방을 만든다. B, C는 방 코드로 참가한다. C 입장 후 각자 차례에 손패를 누르고, 필요한 바닥 선택 및 특수 행동, GO/STOP을 결정한다. 먹은 패 패널을 누르면 확대창이 열린다. 다른 컴퓨터에서 접속하려면 Vite를 `npm run dev -- --host 0.0.0.0`으로 실행하고 호스트 LAN 주소를 사용한다.

```sh
npm run test:online
node --test tests/pansseul.test.mjs
npm run typecheck
npm run build
```

`server/tests/gostop.test.ts`는 3인 분배·손패 비공개·턴 순서·잘못된 요청·특수 이벤트·각 상대 피 이동·폭탄/흔들기·3점 GO/STOP·고박 정산과 40판 카드 보존을 검증한다. `socket.test.ts`는 실제 연결 3개로 대기/시작/정원/방 격리/비공개 상태/동기화/종료를 검증하며, 두 모드의 Vite polling/WebSocket 경로도 검사한다. UI 테스트는 세 좌석의 상대 배치, 뻑 이름, 각 패널, 선택창 권한, 정산 표시를 검사한다. 기존 2인 온라인 및 싱글플레이 규칙 테스트도 함께 실행한다.

로그인, 영속 저장, 재접속 복구, 관전, 재대결은 기존 MVP와 같이 포함하지 않는다.

## 이번 작업의 검증 결과

- 온라인 서버/Socket.IO 테스트 24개, UI 테스트 7개 통과.
- 기존 맞고/고스톱 공통 규칙 테스트 67개 통과.
- `npm run typecheck`, `npm run build` 및 변경한 TypeScript 파일의 ESLint 검사 통과.
- 설치된 Edge의 headless 독립 브라우저 컨텍스트 3개를 사용해 실제 React 화면을 검증했다. 2/3명 대기, 세 번째 참가 후 시작, 자기 손패 7장과 상대 뒷면 14장, 먹은 패 확대창을 확인했다. 세 좌석 모두 화면에서 행동하고 한 판 종료 후 세 화면의 결과 표시를 확인했으며 JavaScript 예외는 없었다. 서로 다른 물리 컴퓨터의 LAN 연결은 별도로 검증하지 않았다.
