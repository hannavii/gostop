# 온라인 대기실 프로토콜

온라인 진입 → 닉네임 입력 → 방 생성/코드 참가 → 준비 → 방장 시작 순서다.
정원이 차거나 모두 준비해도 자동으로 시작하지 않는다. 로그인, DB, Redis 없이 기존 메모리 방을 사용한다.

## Socket.IO

모든 요청은 기존 `Reply` ACK를 사용한다. 생성/참가의 닉네임 인자는 필수이므로 프론트와 서버를 함께 배포해야 한다.

| 이벤트 | 인자 (ACK 제외) | 변경 |
| --- | --- | --- |
| `room:create` | `nickname: string` | 2인 방 생성, 닉네임 필수 |
| `room:create-mode` | `mode, nickname: string` | 모드별 방 생성, 닉네임 필수 |
| `room:join` | `code: string, nickname: string` | 참가 후 대기실 유지 |
| `room:ready` | `ready: boolean` | 신규. 본인 준비/취소, 대기실에서만 허용 |
| `room:start` | 없음 | 신규. 방장·정원·전원 접속·전원 준비를 서버가 검증 |
| `room:state` | `RoomView` | `host: Seat`, 각 `connections` 항목에 `nickname`, `ready` 추가 |

`room:resume`, `room:session`, `room:sync`, `room:leave`, `game:action`의 요청 형식은 유지한다.
`room:closed`는 대기실 이탈자에게만 보내고, 게임 중 실제 이탈 시에는 기존처럼 전체 방에 보낸다.

## 서버 상태와 이탈 정책

- Member: 검증된 `nickname`, 기본값 `false`인 `ready` 추가. trim 후 1~12 UTF-16 코드 유닛, 제어/형식 문자를 거부한다. 중복 닉네임은 허용하며 권한은 닉네임이 아닌 기존 소켓/토큰으로 확인한다.
- Room: `host`는 멤버 객체를 참조한다. 생성자가 최초 방장이며 공개 스냅샷에는 해당 좌석 번호만 보낸다.
- 입장과 준비 변경은 `match: null`을 유지한다. 유효한 방장 시작 요청에서만 기존 `matchFactory`를 호출한다.
- disconnect: 좌석, 닉네임, 준비, 방장을 유지하고 `socketId: null`, 만료 시각과 기존 60초 타이머를 설정한다.
- resume: 기존 해시 토큰 검증과 소켓 교체 정책을 유지한다. 타이머를 취소하고 연결만 복구한다. 닉네임/준비/게임 상태는 변경하지 않는다.
- 대기실 명시적 나가기 또는 grace 만료: 해당 멤버만 제거한다. 방장이 실제 이탈하면 입장 순서상 첫 잔여 멤버에게 승계한다. 잔여 멤버가 오프라인이어도 자신의 grace 동안은 보존한다. 빈 방은 제거한다.
- 대기실 제거 후 좌석 번호는 다시 매기고 `you`, `host`를 전체 동기화한다. 토큰은 멤버에 연결되어 있어 나머지 플레이어의 재접속 신원은 유지된다.
- 게임 시작 이후 실제 이탈: 기존 전체 방 종료 정책을 유지한다. 게임 도중 좌석을 재배치하거나 대체 플레이어를 넣지 않는다. grace 안에서는 자동 턴 진행 없이 기존 턴 검증으로 기다린다.
- 개인 손패, 더미, pending 상태 및 토큰은 기존 개별 공개 projection 정책을 유지한다.

## UI 및 검증

녹색 대기실에 방장, 닉네임, 준비, 연결 상태, 빈 좌석을 표시한다. 게임의 상대 이름과 정산도 닉네임을 사용한다.
방 코드는 대기실/게임 모두 표시하며 Clipboard API 성공/실패 피드백과 직접 텍스트 선택을 지원한다.
F5 복구는 기존 `App.tsx`와 sessionStorage의 방 코드/토큰만으로 수행한다.

검증 명령:

```sh
npm run test:online
node --test tests/pansseul.test.mjs
npm run typecheck
npm run build
npm run test:browser-reconnect
```

브라우저 스크립트는 Edge/Chromium CDP의 독립 컨텍스트로 2인/3인 각각 닉네임, 대기실, 복사/실패 안내, 준비/취소, 대기실 F5, 방장 시작, 모든 게임 좌석 F5, 네트워크 복구, 개인 손패 보호와 후속 행동을 검증한다.
