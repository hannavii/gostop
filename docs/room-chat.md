# Room 채팅과 시스템 메시지

## 빠른 채팅

공통 채팅 패널은 `src/online/quickChat.ts`의 프리셋 10개(ㅋㅋㅋㅋ, 굿!, 잠깐만요, 고!, 나이스, 아깝다, 😭, 😂, 👍, 😎)를 제공한다. 모바일에서 키보드를 열지 않고 사용할 수 있도록 입력창 앞에 44px 이상 버튼을 두 줄로 배치한다. 데스크톱도 같은 작은 버튼 영역을 사용한다. 기존 접이식 패널, 자유 입력, 초안, 오류 표시를 유지한다.

플레이어와 관전자 모두 같은 `send` 콜백으로 기존 `chat:send({ roomCode, message })`를 호출한다. 새 이벤트나 저장 구조, 서버 프리셋 허용 목록은 없다. 일반 채팅과 동일한 membership/역할 검사, 200 UTF-16 길이 제한, 입력 검증, 500ms cooldown 및 React 텍스트 렌더링이 적용된다. 전송 중 버튼은 비활성화하며 서버 오류는 기존 패널에 표시한다. 관전자 이름은 서버가 발급한다.

퀵챗도 `user` 메시지이며 system message, game log, revision, turn deadline 등 게임 상태를 변경하지 않는다. 이모지는 preset만 제공하며 emoji picker나 새 dependency는 추가하지 않는다. 실제 button과 의미 있는 이모지 접근성 이름을 사용하여 Tab/Enter/Space 조작을 지원한다.

채팅은 Match와 독립된 Room 메모리에 저장된다. `RoomChat`이 최근 `MAX_CHAT_HISTORY = 100`개를 순서대로 보관하며, 초과 시 오래된 메시지부터 제거한다. DB와 브라우저 저장소에는 저장하지 않는다. Room 삭제나 서버 재시작 시 사라지고 재대결에서는 유지된다.

`ChatMessage`는 UUID `id`, 서버 ISO `createdAt`, `type`과 `text`를 가진다. `user` 메시지는 서버가 작성한 sender(닉네임, player/spectator role, 플레이어인 경우 seat)를 포함한다. `system` 메시지는 join/leave/disconnect/reconnect event를 포함한다. 토큰·소켓 ID·손패·서버 내부 객체는 포함하지 않는다.

클라이언트는 `chat:send({ roomCode, message }, ack)`만 요청한다. ack는 기존 `{ ok: true }` 또는 `{ ok: false, error }` 형식이다. 서버는 현재 socket의 멤버십과 소유 연결을 확인한 뒤 Room에 연결된 플레이어·관전자에게만 `chat:state({ roomCode, messages })`를 전달한다. Socket.IO의 전역 broadcast나 공개방 목록에는 채팅을 넣지 않는다. 외부 Room과 비회원에 대한 권한 오류는 같은 문구를 사용한다.

플레이어는 기존 닉네임을 사용한다. 관전에는 닉네임 입력이 없으므로 Room별 서버 발급 이름 `관전자 1`, `관전자 2` 등을 사용하며 복구 후에도 유지한다. 닉네임·role·seat·timestamp를 payload에 추가하면 거부한다. 관전자의 게임 권한은 그대로 제한된다.

입력 검증은 기존 `record`와 `RequestError`를 사용한다. 정확히 roomCode와 message만 허용한다. 원문 최대 길이는 shared 상수 `MAX_CHAT_MESSAGE_LENGTH = 200` UTF-16 code unit이며 이모지는 두 칸 이상을 사용할 수 있다. trim 후 빈 값은 거부한다. 한 줄 입력만 허용하고 C0/C1 제어문자, 줄 구분자, 방향 제어문자, zero-width space와 BOM을 거부한다. 이모지 조합에 쓰이는 ZWJ는 허용한다. HTML은 변환·해석하지 않고 React 텍스트로 표시한다.

`CHAT_COOLDOWN_MS = 500` 간격으로 같은 socket의 성공한 메시지를 제한한다. 게임 action 제한은 변경하지 않는다. 실패한 메시지는 UI에 오류를 표시하고 입력을 유지한다. 재접속은 새 socket이므로 cooldown이 초기화된다. 이는 기본 도배 방지이며 계정/IP 기반의 본격적인 abuse 방어는 아니다.

서버 lifecycle 전이에만 시스템 메시지를 생성한다. 입장, 일시 연결 끊김, 복구, 명시적 퇴장과 grace 만료를 구분한다. 동일 소켓 resume 재시도는 복구 메시지를 추가하지 않는다. 새 소켓이 기존 연결을 교체할 때 기존 membership을 먼저 제거하므로 old socket cleanup이 disconnect 메시지를 만들지 않는다. 기존 플레이어 grace 타이머와 방 종료 정책은 유지한다. 관전자 grace 만료는 기존처럼 다음 Room 접근 때 정리하며 이때 퇴장 메시지를 한 번 추가한다. 게임 로그의 기존 disconnect/reconnect 정책은 유지한다.

입장·복구 시 최근 채팅 snapshot을 전달한다. 사용자 채팅 전송은 게임 publish, Match 전이, revision, turn timer sync, ready/rematch vote, game log를 호출하거나 수정하지 않는다. 채팅 전용 폴링도 없다.

`RoomChatLayout`과 채팅 패널은 대기실·게임·관전·정산 화면에서 공통 사용한다. 채팅 업데이트는 게임판을 remount하지 않는다. 데스크톱은 제한된 폭의 별도 영역, 모바일은 기본 접힌 하단 영역으로 게임판을 덮지 않으며 게임판은 자체 스크롤을 유지한다. 입력은 실제 input이며 Enter로 전송하고 IME 조합 Enter는 전송하지 않는다. Shift+Enter도 한 줄 입력의 Enter와 같다. 서버 시간을 HH:mm으로 표시한다. 새 메시지에 aggressive aria-live를 사용하지 않는다.

패널이 닫혀 있을 때 수신한 메시지를 미확인 개수로 표시한다. 열고 닫을 때 읽음 처리하며 F5 후에는 UI 상태를 초기화한다. 패널을 열면 최신 메시지를 보여 주고, 이후에는 스크롤이 하단 40px 이내일 때만 자동 스크롤한다. 명시적 나가기·Room 종료·복구 실패 시 클라이언트 채팅 상태도 비운다.

검증 명령: `npm run test:chat`, `npm run test:e2e`, `npm run test:online`, `npm run test:validation`, `npm run test:history`, `node --test tests/pansseul.test.mjs`, 양쪽 typecheck/build, 변경 파일 ESLint, `git diff --check`.
