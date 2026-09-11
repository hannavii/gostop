import { hwatuCards } from "../src/data/cards";
import { dealCards, dealGostopCards } from "../src/game/deal";
import { GAME_RULES, type GameMode } from "../src/game/rules";
import { calculateScore } from "../src/game/scoring";
import { calculateSettlement } from "../src/game/settlement";
import { calculateGostopSettlement } from "../src/game/gostopSettlement";
import type {
  GostopDrawChoiceState as DrawChoiceState, GostopDrawResult as DrawResult,
  GostopPpeokStack as PpeokStack, GostopPreparedPlay as PreparedPlay,
  GostopSpecialEvent as SpecialEvent, GostopTurnCompleteResult as TurnCompleteResult,
} from "../src/game/gostopTurn";
import { turnEngine } from "./turnEngine";
import type { HwatuCard } from "../src/types/game";
import type { GameAction, GameView, Seat } from "../shared/online";

type Player = { hand: HwatuCard[]; captured: HwatuCard[]; goCount: number; lastGoScore: number;
  bombCount: number; bombPassCount: number; shakeMonths: number[] };
type Pending = { kind: "hand"; card: HwatuCard; matches: HwatuCard[] }
  | { kind: "draw"; choice: DrawChoiceState };
export type Match = {
  mode: GameMode;
  revision: number;
  turn: Seat;
  phase: GameView["phase"];
  players: Player[];
  floor: HwatuCard[];
  pile: HwatuCard[];
  pending: Pending | null;
  revealed: HwatuCard[];
  events: SpecialEvent[];
  ppeokStacks: PpeokStack[];
  result: GameView["result"];
};
export function createMatch(mode: GameMode = "matgo"): Match {
  if (mode !== "matgo" && mode !== "gostop") throw new Error("지원하지 않는 게임 모드입니다.");
  const dealt = mode === "gostop" ? dealGostopCards(hwatuCards) : dealCards(hwatuCards);
  const hands = "opponentCards" in dealt ? [dealt.playerCards, dealt.opponentCards]
    : [dealt.playerCards, dealt.opponent1Cards, dealt.opponent2Cards];
  const player = (hand: HwatuCard[]): Player => ({ hand, captured: [], goCount: 0, lastGoScore: 0,
    bombCount: 0, bombPassCount: 0, shakeMonths: [] });
  return {
    mode, revision: 0, turn: 0, phase: "play",
    players: hands.map(player),
    floor: dealt.floorCards, pile: dealt.drawPile, pending: null,
    revealed: [], events: [], ppeokStacks: [], result: null,
  };
}

function advance(match: Match) {
  if (match.pile.length === 0 && match.players.every(p => p.hand.length + p.bombPassCount === 0)) {
    match.phase = "finished";
    match.result = { winner: "draw", settlement: null };
  } else {
    match.turn = ((match.turn + 1) % match.players.length) as Seat;
    match.phase = "play";
  }
}

function complete(match: Match, raw: TurnCompleteResult) {
  const player = match.players[match.turn];
  const engine = turnEngine(match.mode);
  const result = engine.applyPansseul(raw, player.hand.length + player.bombPassCount);
  player.captured.push(...result.capturedCards);
  for (const opponent of match.players.filter(p => p !== player)) {
    const stolen = engine.stealPiCards(opponent.captured, result.stealPi);
    player.captured.push(...stolen.stolenCards);
    opponent.captured = stolen.remainingCards;
  }
  match.floor = result.floorCards;
  match.ppeokStacks = result.ppeokStacks;
  match.events = [...new Set([...match.events, ...result.specialEvents])];
  match.pending = null;
  const score = calculateScore(player.captured).total;
  if (score >= GAME_RULES[match.mode].goStopScore && score > player.lastGoScore) {
    match.phase = "go-stop";
  } else {
    advance(match);
  }
}

function acceptDraw(match: Match, result: DrawResult) {
  if (result.type === "complete") {
    complete(match, result);
  } else {
    match.pending = { kind: "draw", choice: result };
    match.floor = result.floorCardsBeforeChoice;
    match.phase = "choose";
  }
}

function draw(match: Match, prepared: PreparedPlay) {
  const drawn = match.pile.shift();
  if (!drawn) {
    complete(match, turnEngine(match.mode).finalizePreparedPlay(prepared));
    return;
  }
  match.revealed.push(drawn);
  acceptDraw(match, turnEngine(match.mode).resolveTurnDraw(prepared, drawn));
}

function drawOnly(match: Match, capturedCards: HwatuCard[] = [], stealPi = 0) {
  const drawn = match.pile.shift();
  if (drawn) {
    match.revealed.push(drawn);
    acceptDraw(match, turnEngine(match.mode).resolveDrawOnly(drawn, match.floor, match.turn, match.ppeokStacks,
      capturedCards, stealPi, match.events));
  } else {
    complete(match, { type: "complete", floorCards: match.floor, capturedCards, stealPi,
      specialEvents: match.events, ppeokStacks: match.ppeokStacks });
  }
}

// Runtime validation is required even when a client uses the shared TS types.
export function parseAction(input: unknown): GameAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("잘못된 행동 요청입니다.");
  const a = input as Record<string, unknown>;
  if (Object.keys(a).some(key => !["roomCode", "revision", "type", "cardId"].includes(key)) ||
    typeof a.roomCode !== "string" || !/^[A-Z0-9]{6}$/.test(a.roomCode) ||
    !Number.isSafeInteger(a.revision) || (a.revision as number) < 0 ||
    !["play", "bomb", "shake", "bomb-pass", "choose", "go", "stop"].includes(a.type as string)) {
    throw new Error("잘못된 행동 요청입니다.");
  }
  if (a.type === "play" || a.type === "choose" || a.type === "bomb" || a.type === "shake") {
    if (typeof a.cardId !== "string" || a.cardId.length === 0 || a.cardId.length > 64) {
      throw new Error("카드 ID가 필요합니다.");
    }
  } else if (a.cardId !== undefined) {
    throw new Error("이 행동에는 카드 ID를 보낼 수 없습니다.");
  }
  return a as GameAction;
}

// Synchronous, atomic transition: invalid actions cannot partially mutate the match.
export function applyAction(current: Match, seat: Seat, action: GameAction): Match {
  parseAction(action);
  if (!Number.isInteger(seat) || seat < 0 || seat >= current.players.length) throw new Error("방의 플레이어가 아닙니다.");
  if (action.revision !== current.revision) throw new Error("지난 게임 상태의 요청입니다. 다시 선택해주세요.");
  if (current.phase === "finished") throw new Error("이미 종료된 게임입니다.");
  if (seat !== current.turn) throw new Error("상대방 차례입니다.");
  const match = structuredClone(current);
  const player = match.players[seat];
  const engine = turnEngine(match.mode);

  if (action.type === "bomb-pass") {
    if (match.phase !== "play" || player.bombPassCount <= 0) throw new Error("사용 가능한 폭탄 패스가 없습니다.");
    player.bombPassCount--;
    match.revealed = [];
    match.events = ["bomb-pass"];
    drawOnly(match);
  } else if (action.type === "play" || action.type === "bomb" || action.type === "shake") {
    if (match.phase !== "play") throw new Error("먼저 패 선택 또는 GO/STOP을 완료해주세요.");
    const card = player.hand.find(c => c.id === action.cardId);
    if (!card) throw new Error("자신의 손패에 없는 카드입니다.");
    if (action.type === "bomb") {
      const bomb = engine.getBombActionForMonth(player.hand, match.floor, card.month);
      if (!bomb) throw new Error("폭탄을 사용할 수 없습니다.");
      player.hand = player.hand.filter(c => c.month !== card.month);
      match.floor = match.floor.filter(c => c.id !== bomb.floorCard.id);
      player.bombCount++;
      player.bombPassCount += 2;
      match.revealed = bomb.handCards;
      match.events = ["bomb"];
      drawOnly(match, [...bomb.handCards, bomb.floorCard], 1);
      match.revision++;
      return match;
    }
    if (action.type === "shake") {
      if (player.shakeMonths.includes(card.month) || !engine.canShakeMonth(player.hand, match.floor, card.month)) {
        throw new Error("흔들기를 선언할 수 없습니다.");
      }
      player.shakeMonths.push(card.month);
    }
    const prepared = engine.prepareHandPlay(card, match.floor, seat, match.ppeokStacks);
    player.hand = player.hand.filter(c => c.id !== card.id);
    match.revealed = [card];
    match.events = action.type === "shake" ? ["shake"] : [];
    if (prepared.type === "choice") {
      match.pending = { kind: "hand", card, matches: prepared.matchingCards };
      match.phase = "choose";
    } else {
      draw(match, prepared.prepared);
    }
  } else if (action.type === "choose") {
    const pending = match.pending;
    if (match.phase !== "choose" || !pending) throw new Error("선택할 패가 없습니다.");
    const choices = pending.kind === "hand" ? pending.matches : pending.choice.matchingCards;
    const selected = choices.find(c => c.id === action.cardId);
    if (!selected) throw new Error("선택 가능한 바닥패가 아닙니다.");
    if (pending.kind === "hand") {
      const prepared = engine.prepareHandPlay(pending.card, match.floor, seat, match.ppeokStacks, selected.id);
      if (prepared.type !== "ready") throw new Error("패 선택을 처리할 수 없습니다.");
      draw(match, prepared.prepared);
    } else {
      complete(match, engine.resolveDrawChoice(pending.choice, selected));
    }
  } else {
    if (match.phase !== "go-stop") throw new Error("GO/STOP을 선언할 수 없습니다.");
    if (action.type === "stop") {
      const opponent = match.players[seat === 0 ? 1 : 0];
      match.result = match.mode === "gostop" ? {
        winner: seat, settlement: null,
        gostopSettlement: calculateGostopSettlement({ winner: seat, players: match.players.map((p, index) => ({
          index: index as Seat, cards: p.captured, goCount: p.goCount,
          shakeCount: p.shakeMonths.length, bombCount: p.bombCount,
        })) }),
      } : {
        winner: seat,
        settlement: calculateSettlement(player.captured, opponent.captured, player.goCount, opponent.goCount,
          player.shakeMonths.length, player.bombCount),
      };
      match.phase = "finished";
    } else {
      player.goCount++;
      player.lastGoScore = calculateScore(player.captured).total;
      advance(match);
    }
  }
  match.revision++;
  return match;
}

export function gameView(match: Match, seat: Seat): GameView {
  if (!Number.isInteger(seat) || seat < 0 || seat >= match.players.length) throw new Error("방의 플레이어가 아닙니다.");
  const pending = match.pending;
  const engine = turnEngine(match.mode);
  return structuredClone({
    mode: match.mode, revision: match.revision, turn: match.turn, phase: match.phase,
    hand: match.players[seat].hand,
    players: match.players.map((p, i) => ({
      seat: i as Seat, handCount: p.hand.length, captured: p.captured,
      score: calculateScore(p.captured).total, goCount: p.goCount,
      bombCount: p.bombCount, bombPassCount: p.bombPassCount, shakeMonths: p.shakeMonths,
    })),
    specialOptions: seat === match.turn && match.phase === "play" ? match.players[seat].hand.flatMap<GameView["specialOptions"][number]>(card => {
      if (engine.getBombActionForMonth(match.players[seat].hand, match.floor, card.month)) {
        return [{ cardId: card.id, type: "bomb" as const }];
      }
      if (!match.players[seat].shakeMonths.includes(card.month) && engine.canShakeMonth(match.players[seat].hand, match.floor, card.month)) {
        return [{ cardId: card.id, type: "shake" as const }];
      }
      return [];
    }) : [],
    floor: match.floor, drawCount: match.pile.length,
    choice: seat === match.turn && pending
      ? pending.kind === "hand" ? pending.matches : pending.choice.matchingCards : null,
    revealed: match.revealed, specialEvents: match.events,
    ppeokStacks: match.ppeokStacks, result: match.result,
  });
}
