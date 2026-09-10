import type { CSSProperties } from "react";
export const GAME_SPEED = {
  // 내가 손에서 카드를 내는 이동 시간
  playerPlay: 750,

  // 상대가 손에서 카드를 내는 이동 시간
  opponentPlay: 800,

  // 더미 카드가 가운데로 이동하는 시간
  drawMove: 650,

  // 더미/상대 카드가 앞면으로 공개된 뒤 보여주는 시간
  revealHold: 700,

  // 카드 뒤집기 자체의 회전 시간
  flip: 280,

  // 먹은 패 패널로 날아가는 시간
  captureMove: 750,

  // 낸 카드가 바닥패 위에 겹쳐지는 시간
  stackIn: 300,

  // 흔들기 공개를 보여주는 시간
  shakeReveal: 1200,

  // 뻑 / 쪽 / 따닥 / 폭탄 같은 효과 표시 시간
  specialEffect: 900,

  // 한 행동이 끝난 뒤 다음 턴으로 넘어가기 전 여유 시간
  resultPause: 400,

  // 폭탄 처리 후 더미를 뒤집기 전 여유 시간
  bombPause: 300,

  // 상대 턴이 시작되고 AI가 행동하기 전 시간
  opponentThink: 800,

  // 상대의 행동이 전부 끝난 뒤 내 턴으로 넘어가기 전 시간
  opponentAfterAction: 500,

  // 상대가 STOP을 선언했을 때 결과창 전 표시 시간
  opponentStopHold: 900,

  // 상대 턴 자체가 시작되기 전 기본 지연
  opponentTurnDelay: 650,
} as const;

/*
 * CSS 애니메이션 시간도 GAME_SPEED와 자동으로 맞춥니다.
 * 따라서 아래 CSS 변수용 코드까지 적용한 뒤에는
 * App.css를 다시 건드리지 않고 GAME_SPEED만 수정하면 됩니다.
 */
export const GAME_SPEED_STYLE = {
  "--player-play-duration": `${GAME_SPEED.playerPlay}ms`,
  "--opponent-play-duration": `${GAME_SPEED.opponentPlay}ms`,
  "--draw-flight-duration": `${GAME_SPEED.drawMove}ms`,
  "--flip-duration": `${GAME_SPEED.flip}ms`,
  "--capture-flight-duration": `${GAME_SPEED.captureMove}ms`,
  "--stack-in-duration": `${GAME_SPEED.stackIn}ms`,
  "--special-effect-duration": `${GAME_SPEED.specialEffect}ms`,
} as CSSProperties;

