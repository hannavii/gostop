import type { HwatuCard } from "../src/types/game";
import type { GostopPpeokStack as PpeokStack, GostopSpecialEvent as SpecialEvent } from "../src/game/gostopTurn";
import type { SettlementResult } from "../src/game/settlement";
import type { GostopSettlementResult } from "../src/game/gostopSettlement";
import type { GameMode } from "../src/game/rules";

export const NICKNAME_MAX_LENGTH = 12;
export type RoomVisibility = 'private' | 'public';
export type CreateRoomRequest = { mode: GameMode; nickname: string; visibility: RoomVisibility };
export type PublicRoomSummary = { roomCode: string; mode: GameMode; playerCount: number; maxPlayers: number };
export type Seat = 0 | 1 | 2;
export type GameLogEvent =
  | { type: 'start'; payload: { rematch: boolean } }
  | { type: 'play' | 'choose' | 'bomb' | 'shake'; playerSeat: Seat;
      payload: { month: number; category: HwatuCard['category']; automatic: boolean } }
  | { type: 'bomb-pass' | 'stop'; playerSeat: Seat; payload: { automatic: boolean } }
  | { type: 'go'; playerSeat: Seat; payload: { automatic: boolean; goCount: number } }
  | { type: 'special'; playerSeat: Seat; payload: { event: SpecialEvent } }
  | { type: 'finished'; payload: { winner: Seat | 'draw' } }
  | { type: 'disconnect' | 'reconnect'; playerSeat: Seat; payload: Record<string, never> };
export type GameLogEntry = GameLogEvent & { id: string; round: number; revision: number; sequence: number };
export type GameAction = {
  // Optional for existing clients; room-wide revisions also reject previous deals.
  round?: number;
  roomCode: string;
  revision: number;
  type: "play" | "bomb" | "shake" | "bomb-pass" | "choose" | "go" | "stop";
  cardId?: string;
};
export type TurnTimerView = { turnDeadline: number; startsAt: number; timedPlayerSeat: Seat; decisionPhase: Exclude<GameView["phase"], "finished"> };
export type RematchRequest = { roomCode: string; round: number; ready: boolean };
export type Reply = { ok: true } | { ok: false; error: string };
export type Ack = (reply: Reply) => void;
export type ReconnectSession = { roomCode: string; token: string; role?: "spectator" };

// Explicit public projection. Never add the server's hands, pile or pending state here.
export type GameView = {
  mode: GameMode;
  revision: number;
  turn: Seat;
  phase: "play" | "choose" | "go-stop" | "finished";
  hand: HwatuCard[];
  // Viewer-specific permission, computed by the server (including bomb passes).
  canPlayHand: boolean;
  players: { seat: Seat; handCount: number; captured: HwatuCard[]; score: number; goCount: number;
    bombCount: number; bombPassCount: number; shakeMonths: number[] }[];
  specialOptions: { cardId: string; type: "bomb" | "shake" }[];
  floor: HwatuCard[];
  drawCount: number;
  choice: HwatuCard[] | null;
  revealed: HwatuCard[];
  specialEvents: SpecialEvent[];
  ppeokStacks: PpeokStack[];
  result: { winner: Seat | "draw"; settlement: SettlementResult | null;
    gostopSettlement?: GostopSettlementResult } | null;
};
export type RoomView = { code: string; mode: GameMode; capacity: number; you: Seat; occupancy: number;
  host: Seat; round: number;
  turnTimer?: TurnTimerView | null;
  logs?: GameLogEntry[];
  // Server epoch milliseconds; display only. Connected seats have a null deadline.
  connections: { seat: Seat; nickname: string; ready: boolean; rematchReady: boolean; connected: boolean; reconnectDeadline: number | null }[];
  game: GameView | null; completedResult?: GameResultRecord | null };

export type SpectatorRoomView = Omit<RoomView, "you" | "completedResult"> & { role: "spectator"; you: null };

export interface ClientEvents {
  "room:spectate": (request: { roomCode: string }, ack: Ack) => void;
  "room:spectator-resume": (session: ReconnectSession, ack: Ack) => void;
  "room:create-options": (request: CreateRoomRequest, ack: Ack) => void;
  "room:list": (ack: Ack) => void;
  "room:create": (nickname: string, ack: Ack) => void;
  "room:create-mode": (mode: GameMode, nickname: string, ack: Ack) => void;
  "room:join": (code: string, nickname: string, ack: Ack) => void;
  "room:ready": (ready: boolean, ack: Ack) => void;
  "room:start": (ack: Ack) => void;
  "room:resume": (session: ReconnectSession, ack: Ack) => void;
  "room:leave": (ack: Ack) => void;
  "room:sync": (ack: Ack) => void;
  "game:rematch": (request: RematchRequest, ack: Ack) => void;
  "game:action": (action: GameAction, ack: Ack) => void;
}
export interface ServerEvents {
  "room:spectator-state": (view: SpectatorRoomView) => void;
  "room:list": (rooms: PublicRoomSummary[]) => void;
  "room:list-changed": () => void;
  "room:session": (session: ReconnectSession) => void;
  "room:state": (view: RoomView) => void;
  "room:closed": (reason: string) => void;
}

export type GameResultRecord = {
  version: 1;
  id: string;
  completedAt: string;
  mode: GameMode;
  round: number;
  players: { seat: Seat; nickname: string }[];
  winnerSeat: Seat | 'draw';
  results: { seat: Seat; outcome: 'win' | 'loss' | 'draw'; score: number; goCount: number; payment: number; received: number }[];
  specialEvents: { type: SpecialEvent; playerSeat: Seat; count: number }[];
  settlement: SettlementResult | null;
  gostopSettlement: GostopSettlementResult | null;
};
