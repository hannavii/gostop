# 온라인 행동 제한시간

2인 맞고와 3인 고스톱은 동일한 서버 authoritative 타이머를 사용한다.
기본값은 `server/turnTimer.ts`의 `TURN_TIMEOUT_MS = 30_000` 한 곳에서 관리한다.
타이머 설정·취소·만료 및 자동 행동은 서버만 수행한다.

## 선택 단계

`play`, `choose`(손패 또는 더미 매칭), `go-stop`마다 새 제한시간을 부여한다.
폭탄·흔들기 확인창은 서버 단계가 아닌 로컬 UI이므로 현재 `play` 시간을 공유한다.
창을 열거나 취소해도 시간이 연장되지 않는다.

서버는 기존 presentationFrames를 각 좌석의 공개 projection에 적용해 가장 긴
애니메이션 시간을 계산한다. 그 시간이 지난 `startsAt`부터 30초를 보장한다.
타이머가 애니메이션 중 표시될 때는 30초로 유지된다. 클라이언트 준비 이벤트는 사용하지 않는다.
실제 네트워크 지연·백그라운드 탭의 렌더 지연은 이 예상 시간에 포함되지 않는다.
자동 행동 역시 applyAction → room:state → 기존 presentation 흐름을 사용한다.

## 만료 정책

- 일반 손패: 카드 ID 오름차순 첫 카드로 일반 플레이한다.
- 매칭: 합법 후보의 카드 ID 오름차순 첫 카드를 선택한다.
- 폭탄·흔들기: 선언하지 않고 일반 플레이한다.
- 의무 폭탄 패스 또는 손패가 없는 폭탄 패스 단계: 기존 규칙에 따라 패스한다.
- GO/STOP: STOP한다.

private hand는 서버에서만 사용하며 공개 상태에는 추가하지 않는다.
클라이언트 timeout 이벤트나 timeout action 타입은 없다. 기존 입력 검증을 그대로 사용한다.

## 수명과 재접속

현재 행동할 좌석이 disconnect되면 타이머를 취소하며 자동 행동하지 않는다.
기존 60초 reconnect grace와 방 종료 정책을 유지한다.
재접속하면 해당 단계에 새 30초를 부여한다. 다른 좌석의 disconnect는 현재 타이머를 연장하지 않는다.
동일 상태의 room:sync도 제한시간을 연장하지 않는다.

종료·방 삭제·서버 종료 시 타이머를 취소한다. 재대결 대기에는 타이머가 없으며
새 match에는 새 타이머를 부여한다. callback은 generation, match 객체, phase,
seat를 검사하고 방 존재 여부도 확인하므로 이전 callback이 새 게임을 진행시키지 못한다.

## 공개 상태 및 표시

기존 room:state의 `turnTimer`에 startsAt, turnDeadline, timedPlayerSeat,
decisionPhase만 추가한다. 내부 generation은 노출하지 않는다. 초당 broadcast는 없다.
클라이언트는 로컬 시각으로 표시만 갱신하고 0에서 멈춘다. 10초 이하는 색상과 테두리로 강조한다.
기기 시계 오차는 표시 오차를 만들 수 있으나 서버의 만료 판정에는 영향을 주지 않는다.

## 검증

`npm run test:online`에 fake timer 및 countdown 테스트가 포함된다.
`node --import tsx tests/browser-reconnect.mjs --timer`는 Edge 독립 컨텍스트에서
2인·3인 360px의 실제 30초 자동 행동과 countdown을 검증한다.
기존 `npm run test:browser-mobile`은 360/375/390/412px 및 데스크톱 회귀를 검증한다.
