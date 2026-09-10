import type { HwatuCard } from "../src/types/game";
import type { PpeokStack, SpecialEvent } from "../src/game/turn";
import type { SettlementResult } from "../src/game/settlement";

export type Seat = 0 | 1;
export type GameAction = {
  roomCode: string;
  revision: number;
  type: "play" | "choose" | "go" | "stop";
  cardId?: string;
};
export type Reply = { ok: true } | { ok: false; error: string };
export type Ack = (reply: Reply) => void;

// Explicit public projection. Never add the server's hands, pile or pending state here.
export type GameView = {
  revision: number;
  turn: Seat;
  phase: "play" | "choose" | "go-stop" | "finished";
  hand: HwatuCard[];
  players: { seat: Seat; handCount: number; captured: HwatuCard[]; score: number; goCount: number }[];
  floor: HwatuCard[];
  drawCount: number;
  choice: HwatuCard[] | null;
  revealed: HwatuCard[];
  specialEvents: SpecialEvent[];
  ppeokStacks: PpeokStack[];
  result: { winner: Seat | "draw"; settlement: SettlementResult | null } | null;
};
export type RoomView = { code: string; you: Seat; occupancy: number; game: GameView | null };

export interface ClientEvents {
  "room:create": (ack: Ack) => void;
  "room:join": (code: string, ack: Ack) => void;
  "room:leave": (ack: Ack) => void;
  "room:sync": (ack: Ack) => void;
  "game:action": (action: GameAction, ack: Ack) => void;
}
export interface ServerEvents {
  "room:state": (view: RoomView) => void;
  "room:closed": (reason: string) => void;
}
