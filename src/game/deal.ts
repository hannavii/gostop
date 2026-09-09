import type { HwatuCard } from "../types/game";
import { shuffleCards } from "./shuffle";

/* =========================
   2인 맞고
========================= */

export type MatgoDealResult = {
  playerCards: HwatuCard[];
  opponentCards: HwatuCard[];
  floorCards: HwatuCard[];
  drawPile: HwatuCard[];
};

export function dealCards(
  cards: HwatuCard[]
): MatgoDealResult {
  const shuffled =
    shuffleCards(cards);

  const playerCards =
    shuffled.slice(0, 10);

  const opponentCards =
    shuffled.slice(10, 20);

  const floorCards =
    shuffled.slice(20, 28);

  const drawPile =
    shuffled.slice(28);

  return {
    playerCards,
    opponentCards,
    floorCards,
    drawPile,
  };
}

/* =========================
   3인 고스톱
========================= */

export type GostopDealResult = {
  playerCards: HwatuCard[];

  opponent1Cards:
    HwatuCard[];

  opponent2Cards:
    HwatuCard[];

  floorCards: HwatuCard[];

  drawPile: HwatuCard[];
};

export function dealGostopCards(
  cards: HwatuCard[]
): GostopDealResult {
  const shuffled =
    shuffleCards(cards);

  /*
   * 3인 고스톱
   *
   * 나       7장
   * 상대 1   7장
   * 상대 2   7장
   * 바닥     6장
   * 더미    21장
   *
   * 총 48장
   */

  const playerCards =
    shuffled.slice(0, 7);

  const opponent1Cards =
    shuffled.slice(7, 14);

  const opponent2Cards =
    shuffled.slice(14, 21);

  const floorCards =
    shuffled.slice(21, 27);

  const drawPile =
    shuffled.slice(27);

  return {
    playerCards,
    opponent1Cards,
    opponent2Cards,
    floorCards,
    drawPile,
  };
}