# 온라인 최근 행동 로그

## 서버 authoritative 기록

로그는 온라인 Room의 GameLog에 저장한다. 수동 행동과 turn timeout은 동일한
`commitAction → applyAction 성공 → 로그 추가 → room:state` 경로를 사용한다.
거부된 요청·이전 revision 재전송은 로그를 만들지 않는다. 게임 엔진과 싱글플레이는 수정하지 않았다.

공개 `RoomView.logs`는 `GameLogEntry[]`다. 각 entry는 type과 구조화된 payload,
round, revision, sequence, id를 가진다. ID는 공개 room code·round·sequence 조합이다.
같은 revision의 여러 항목과 연결 변화도 sequence로 구분하며 모든 좌석이 같은 배열을 받는다.
시계나 timestamp 대신 서버의 sequence가 순서를 결정한다. optional 필드는 기존 fixture와 호환하기 위한 것으로,
새 서버는 항상 logs 배열을 보낸다. 클라이언트는 없는 entry를 만들어 보충하지 않는다.

## 기록하는 이벤트

- start: 게임 시작 또는 재대결 새 판 시작
- play / choose: 실제로 제출한 손패 또는 확정한 바닥패 선택
- bomb / shake / bomb-pass: 폭탄·흔들기·폭탄 패스
- go / stop: 실제 GO 횟수와 STOP
- special: 엔진이 확정한 뻑·쪽·따닥·판쓸이·뻑 먹기·자뻑 회수
- finished: 실제 종료 결과의 승자 또는 무승부
- disconnect / reconnect: 게임·정산 중 연결 종료와 좌석 복구

카드 payload는 확정되어 공개된 해당 카드의 month/category만 보낸다. 후보 목록,
나머지 손패, 다음 더미 카드, card ID, 토큰, socket ID, timer/generation, 내부 객체는 넣지 않는다.
특수 상황은 엔진 events를 사용하며 UI가 카드를 분석하거나 규칙을 다시 판정하지 않는다.
행동 종류와 같은 bomb/shake/bomb-pass 특수 이벤트는 별도 중복 entry를 만들지 않는다.
choose로 나누어 처리되는 턴은 이전에 기록하지 않은 확정 이벤트만 추가한다.
GO/STOP 시 이전 턴의 특수 이벤트를 다시 기록하지 않는다. STOP 다음에 finished가 기록된다.

timeout은 별도 '시간 초과' 줄을 만들지 않고 실제 fallback action에 `automatic: true`를 붙인다.
UI는 한 줄에 '시간 초과 · 자동 행동'을 표시한다. 특수 상황이나 종료는 별개의 실제 결과이므로
추가로 기록될 수 있다. automatic 값은 서버만 설정하고 클라이언트 입력에서는 허용하지 않는다.

애니메이션 프레임, countdown tick, room:state publish/sync, 버튼 열기·닫기, 준비 변경,
재대결 동의 변경, 같은 소켓의 resume 재시도는 기록하지 않는다.
대기실의 연결 변화는 기존 ConnectionStatus로만 표시해 좌석 재정렬과 불필요한 로그를 피한다.
grace 만료로 Room이 제거되면 기존 room:closed 사유를 표시하며 삭제된 방의 로그를 보존하지 않는다.

## 수명·복구·크기

현재 round의 최근 **256개**만 유지한다. 48장 게임의 일반 행동·선택·GO/특수 상황은
통상 수십~수백 entry이며, 256개는 정상적인 한 판 기록에 여유를 주면서 반복 연결 변화로
메모리가 무제한 증가하는 것을 막는다. 상수는 server/gameLog.ts 한 곳에서 관리한다.
제한에 도달해도 sequence는 되감지 않고 가장 오래된 항목부터 제거한다.

F5 또는 새 소켓의 토큰 복구는 기존 배열을 다시 받고 reconnect 기록을 추가한다.
이미 연결된 같은 소켓의 복구 재시도는 새 기록을 만들지 않는다.
새 round에서는 이전 기록을 비우고 새 start entry부터 시작한다. 방 삭제/서버 종료 시
로그도 메모리에서 해제된다. DB·Redis·영구 저장·다운로드 기능은 추가하지 않았다.

## 표시

게임 toolbar의 실제 버튼으로 패널을 열고 닫는다. 기본은 접힌 상태이며,
열면 최신순으로 제한된 높이 안에서 스크롤한다. 자동 scroll 명령을 실행하지 않아
과거 내용을 읽는 사용자의 위치를 강제로 이동시키지 않는다. live announcement도 사용하지 않는다.
모바일은 toolbar의 문서 흐름 안에 배치해 손패·바닥패·행동 버튼 위를 덮지 않는다.

UI는 서버 entry의 문구 formatting과 표시만 수행한다. round가 다른 항목은 표시하지 않고,
같은 판의 낮은 sequence snapshot이 최신 기록을 덮지 못하게 한다. 해당 action revision의
로그는 기존 presentation animation이 끝날 때까지 표시를 보류해 결과를 미리 알려주지 않는다.
로그 패널 크기 변화는 기존 카드 비행 좌표 측정에 반영한다.

정산 화면에서는 같은 패널을 결과 모달 안에 둔다. STOP/finished 기록은 유지하며
상세 정산·획득패·재대결·연결 상태 UI를 덮지 않는다.

## 검증

`npm run test:online`은 서버 기록·특수 이벤트·중복/위조 거부·유지 개수·공개 payload와
UI formatting을 검증한다. `npm run test:e2e`는 2인/3인의 동일 로그와 순서,
F5 복구, animation 시점, timeout 자동 행동, 정산의 STOP/종료, rematch 초기화를 검증한다.
360/390px 프로젝트와 375/412px 추가 크기에서 패널 열기·닫기·overflow·게임 영역 겹침도 검사한다.
