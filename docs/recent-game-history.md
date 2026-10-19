# 브라우저 최근 경기 기록

`shared/online.ts`의 `GameResultRecord`는 version 1의 직렬화 가능한 공개 결과다. UUID, ISO 종료 시각, 모드, round, 참가 좌석/닉네임, 승자, 좌석별 outcome/점수/GO/실제 부담/수령, 특수 이벤트 횟수와 기존 정산 결과를 담는다. 닉네임은 표시용이며 인증된 사용자 ID가 아니다.

서버 `commitAction`에서 엔진 전이와 로그가 성공한 뒤 finished 결과를 생성한다. 방의 `completedResult`에 보관하며 broadcast나 reconnect에서 재생성하지 않는다. 재대결 시작 시 비우므로 다음 round는 새로운 UUID를 갖는다. 비정상 연결 종료로 방이 폐쇄되는 경우에는 완료 경기로 기록하지 않는다.

승패와 GO는 서버 Match에서, 점수는 기존 서버 scoring에서, 실제 부담/수령과 고박 대납은 기존 settlement에서 가져온다. 클라이언트는 규칙을 재계산하지 않는다. 무승부는 모든 좌석의 outcome이 draw이고 정산은 없다.

GameLog가 확정한 폭탄, 흔들기, 뻑, 쪽, 따닥, 판쓸이, 뻑 먹기와 자뻑 먹기를 좌석별로 집계한다. 집계는 로그의 256개 제한과 별개여서 연결 이벤트가 반복되어도 유지된다. GO는 개인 goCount에 별도로 기록하며 폭탄 패스는 주요 이벤트 집계에서 제외한다.

결과는 플레이어의 `room:state.completedResult`에만 포함한다. 관전자 상태에는 이 필드가 없으며, 클라이언트 저장 함수도 관전자 역할을 거부한다. 손패, 획득패 snapshot, 덱, 토큰, 소켓, 선택 대기 상태, 타이머를 기록하지 않는다. 서버는 Match나 회원 객체를 펼치지 않고 필요한 필드만 선택한다.

`src/online/recentGameHistory.ts`가 list/add/clear 저장 경계를 제공한다. `gostop.recent-games.v1` localStorage에 `{ record, you }`를 최대 30개, 종료 시각 최신순으로 보관한다. `you`는 서버가 해당 연결에 지정한 좌석이며 닉네임으로 추정하지 않는다. 같은 result ID는 중복 저장하지 않는다. JSON/버전/필드/정산 구조가 손상된 항목은 무시하고, 저장소 접근/용량 오류는 게임 진행으로 전파하지 않는다. 삭제는 사용자 확인 후 수행한다.

UI는 최근 경기 목록, 개인 승패/점수/수령/부담/GO, 특수 이벤트, 참가자 및 기존 정산 컴포넌트를 사용한 상세 보기를 제공한다. 요약은 저장된 기록만 집계하며 무승부도 별도로 표시한다. 승률 분모는 저장된 전체 경기 수다.

현재 기록은 해당 브라우저가 플레이어로 받은 로컬 기록이다. 계정이나 DB 기반 공식 영구 전적이 아니며, 사이트 데이터 삭제 시 사라지고 기기 간 동기화되지 않는다. 서버 재시작 후의 결과 재전달도 보장하지 않는다. 저장소 실패 시 알림을 표시하며 플레이는 계속된다.

향후 서버에서 동일한 공개 GameResultRecord를 DB repository에 저장하고 인증된 사용자/좌석 관계를 별도로 연결할 수 있다. 인증된 API repository를 제공하고 UI의 repository 의존성을 교체하면 된다. 닉네임이나 reconnect 토큰을 영구 identity로 사용해서는 안 된다.

검증: `npm run test:history`, `npm run test:e2e`, 기존 온라인/validation/규칙 테스트, 양쪽 typecheck/build, 변경 파일 ESLint 및 `git diff --check`.
