# 온라인 서버 입력 검증

`npm run test:validation`은 실제 Socket.IO 연결로 비정상 요청과 중복 요청을 검사한다.
`npm run test:online`에도 포함되어 있다. 브라우저 정상 흐름은 기존 `npm run test:e2e`로 검증한다.

- 이벤트별 인자 개수와 ACK를 확인한다. ACK 없는 요청은 적용하지 않으며, 추가 인자는 오류 응답으로 거부한다.
- 닉네임은 trim 후 1~12자, 제어/서식 문자 금지 정책을 유지한다. 비정상적으로 긴 원문은 1,024자에서 제한한다.
- 방 코드는 영문·숫자 6자리다. 참가 시에만 기존대로 소문자를 대문자로 정규화한다. Room과 membership 저장에는 Map을 유지한다.
- action/resume/rematch 객체는 허용된 필드만 받는다. revision/round는 안전한 정수로 검사한다. 좌석은 payload가 아닌 서버의 socket membership에서 결정한다.
- 행동의 현재 턴, 실제 손패, phase, pending 후보, 폭탄/흔들기/필수 패스 조건은 기존 서버 엔진에서 검사한다. 실패하면 Match와 로그를 갱신하지 않는다. 로그 생성도 복사본에서 준비한다.
- 기존 action payload의 호환성을 위해 round는 선택 필드다. 전달하면 현재 round와 대조한다. 생략해도 재대결마다 증가하는 room-wide revision이 이전 판의 요청을 거부한다. revision을 임의로 최신 값으로 다시 작성한 요청은 새 요청이므로 현재 권한·손패·phase 검증을 받는다.
- start/행동/GO/STOP은 phase와 revision으로 중복 적용을 차단한다. 같은 판의 동일 rematch 투표는 멱등적이며, 새 판 이후 옛 투표는 거부한다.
- reconnect token은 소유자만 받는 bearer credential이다. 다른 방의 token과 이미 다른 좌석에 속한 socket의 좌석 전환은 거부한다. 유효 token을 가진 새 socket의 F5 복구는 기존처럼 이전 socket을 해제한다. token 자체를 가진 연결을 추가 인증으로 구분하지는 않는다.
- 같은 socket의 resume 재시도는 턴 마감시각과 로그를 바꾸지 않는다. reconnect 60초와 턴 제한 30초 정책은 유지한다. 기존 턴 타이머의 generation 검사를 유지하며 reconnect 만료 콜백도 현재 timer 소유권을 확인한다.
- ACK 형식은 `{ ok: true }` 또는 `{ ok: false, error: string }`이다. 의도된 `RequestError`만 사용자 메시지를 전달하고, 예상 밖 예외는 일반 오류로 바꾼다. 서버 진단에는 작업 종류·오류 종류·스택의 해시 지문만 남긴다. 원문 메시지/스택/경로/payload/token은 기록하지 않는다.
- 비동기 턴 처리·disconnect·재접속 만료의 예외는 경계에서 진단하고 해당 방을 종료한다. 프로세스 전체로 예외를 전파하거나 불완전한 게임을 계속 진행하지 않는다.
- 공개 snapshot은 좌석별 자기 손패만 포함한다. 상대 손패, token/hash, socket ID, pile/pending, 내부 timer는 보내지 않는다. 행동 로그에도 공개 행동의 월·종류 등만 기록한다.

전체 rate limiter, token 추가 인증, 외부 모니터링 연동은 이번 변경의 범위에 포함하지 않는다.
