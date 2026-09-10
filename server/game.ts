import { hwatuCards } from "../src/data/cards";
import { dealCards } from "../src/game/deal";
import { GAME_RULES } from "../src/game/rules";
import { calculateScore } from "../src/game/scoring";
import { calculateSettlement } from "../src/game/settlement";
import {
  applyPansseul, finalizePreparedPlay, prepareHandPlay, resolveDrawChoice,
  resolveTurnDraw, stealPiCards,
  type DrawChoiceState, type DrawResult, type PpeokStack,
  type PreparedPlay, type SpecialEvent, type TurnCompleteResult,
} from "../src/game/turn";
import type { HwatuCard } from "../src/types/game";
import type { GameAction, GameView, Seat } from "../shared/online";

type Player = { hand: HwatuCard[]; captured: HwatuCard[]; goCount: number; lastGoScore: number };
type Pending = { kind: "hand"; card: HwatuCard; matches: HwatuCard[] }
  | { kind: "draw"; choice: DrawChoiceState };
export type Match = {
  revision: number;
  turn: Seat;
  phase: GameView["phase"];
  players: [Player, Player];
  floor: HwatuCard[];
  pile: HwatuCard[];
  pending: Pending | null;
  revealed: HwatuCard[];
  events: SpecialEvent[];
  ppeokStacks: PpeokStack[];
  result: GameView["result"];
};
const side = (seat: Seat) => seat === 0 ? "player" as const : "opponent" as const;
const other = (seat: Seat): Seat => seat === 0 ? 1 : 0;

export function createMatch(): Match {
  const dealt = dealCards(hwatuCards);
  const player = (hand: HwatuCard[]): Player => ({ hand, captured: [], goCount: 0, lastGoScore: 0 });
  return {
    revision: 0, turn: 0, phase: "play",
    players: [player(dealt.playerCards), player(dealt.opponentCards)],
    floor: dealt.floorCards, pile: dealt.drawPile, pending: null,
    revealed: [], events: [], ppeokStacks: [], result: null,
  };
}

function advance(match: Match) {
  if (match.pile.length === 0 && match.players.every(p => p.hand.length === 0)) {
    match.phase = "finished";
    match.result = { winner: "draw", settlement: null };
  } else {
    match.turn = other(match.turn);
    match.phase = "play";
  }
}

function complete(match: Match, raw: TurnCompleteResult) {
  const player = match.players[match.turn];
  const opponent = match.players[other(match.turn)];
  const result = applyPansseul(raw, player.hand.length);
  const stolen = stealPiCards(opponent.captured, result.stealPi);
  player.captured.push(...result.capturedCards, ...stolen.stolenCards);
  opponent.captured = stolen.remainingCards;
  match.floor = result.floorCards;
  match.ppeokStacks = result.ppeokStacks;
  match.events = result.specialEvents;
  match.pending = null;
  const score = calculateScore(player.captured).total;
  if (score >= GAME_RULES.matgo.goStopScore && score > player.lastGoScore) {
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
    complete(match, finalizePreparedPlay(prepared));
    return;
  }
  match.revealed.push(drawn);
  acceptDraw(match, resolveTurnDraw(prepared, drawn));
}

// Runtime validation is required even when a client uses the shared TS types.
export function parseAction(input: unknown): GameAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("잘못된 행동 요청입니다.");
  const a = input as Record<string, unknown>;
  if (Object.keys(a).some(key => !["roomCode", "revision", "type", "cardId"].includes(key)) ||
    typeof a.roomCode !== "string" || !/^[A-Z0-9]{6}$/.test(a.roomCode) ||
    !Number.isSafeInteger(a.revision) || (a.revision as number) < 0 ||
    !["play", "choose", "go", "stop"].includes(a.type as string)) {
    throw new Error("잘못된 행동 요청입니다.");
  }
  if (a.type === "play" || a.type === "choose") {
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
  if (action.revision !== current.revision) throw new Error("지난 게임 상태의 요청입니다. 다시 선택해주세요.");
  if (current.phase === "finished") throw new Error("이미 종료된 게임입니다.");
  if (seat !== current.turn) throw new Error("상대방 차례입니다.");
  const match = structuredClone(current);
  const player = match.players[seat];

  if (action.type === "play") {
    if (match.phase !== "play") throw new Error("먼저 패 선택 또는 GO/STOP을 완료해주세요.");
    const card = player.hand.find(c => c.id === action.cardId);
    if (!card) throw new Error("자신의 손패에 없는 카드입니다.");
    const prepared = prepareHandPlay(card, match.floor, side(seat), match.ppeokStacks);
    player.hand = player.hand.filter(c => c.id !== card.id);
    match.revealed = [card];
    match.events = [];
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
      const prepared = prepareHandPlay(pending.card, match.floor, side(seat), match.ppeokStacks, selected.id);
      if (prepared.type !== "ready") throw new Error("패 선택을 처리할 수 없습니다.");
      draw(match, prepared.prepared);
    } else {
      complete(match, resolveDrawChoice(pending.choice, selected));
    }
  } else {
    if (match.phase !== "go-stop") throw new Error("GO/STOP을 선언할 수 없습니다.");
    if (action.type === "stop") {
      const opponent = match.players[other(seat)];
      match.result = {
        winner: seat,
        settlement: calculateSettlement(player.captured, opponent.captured, player.goCount, opponent.goCount),
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
  const pending = match.pending;
  return structuredClone({
    revision: match.revision, turn: match.turn, phase: match.phase,
    hand: match.players[seat].hand,
    players: match.players.map((p, i) => ({
      seat: i as Seat, handCount: p.hand.length, captured: p.captured,
      score: calculateScore(p.captured).total, goCount: p.goCount,
    })),
    floor: match.floor, drawCount: match.pile.length,
    choice: seat === match.turn && pending
      ? pending.kind === "hand" ? pending.matches : pending.choice.matchingCards : null,
    revealed: match.revealed, specialEvents: match.events,
    ppeokStacks: match.ppeokStacks, result: match.result,
  });
}
