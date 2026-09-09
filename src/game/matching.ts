import type { HwatuCard } from "../types/game";

export type MatchResult =
  | {
      type: "resolved";
      floorCards: HwatuCard[];
      capturedCards: HwatuCard[];
    }
  | {
      type: "choice";
      matchingCards: HwatuCard[];
    };

export function findSameMonthCards(
  card: HwatuCard,
  floorCards: HwatuCard[]
): HwatuCard[] {
  return floorCards.filter(
    (floorCard) => floorCard.month === card.month
  );
}

export function resolveCardAgainstFloor(
  card: HwatuCard,
  floorCards: HwatuCard[]
): MatchResult {
  const matchingCards = findSameMonthCards(
    card,
    floorCards
  );

  // 같은 월이 없음
  // → 낸 카드를 바닥에 둠
  if (matchingCards.length === 0) {
    return {
      type: "resolved",
      floorCards: [...floorCards, card],
      capturedCards: [],
    };
  }

  // 같은 월이 1장
  // → 두 장을 먹음
  if (matchingCards.length === 1) {
    const matchedCard = matchingCards[0];

    return {
      type: "resolved",

      floorCards: floorCards.filter(
        (floorCard) =>
          floorCard.id !== matchedCard.id
      ),

      capturedCards: [
        card,
        matchedCard,
      ],
    };
  }

  // 같은 월이 2장
  // → 플레이어가 하나 선택
  if (matchingCards.length === 2) {
    return {
      type: "choice",
      matchingCards,
    };
  }

  // 같은 월이 3장
  // → 총 4장 모두 먹음
  const matchingIds = new Set(
    matchingCards.map(
      (matchingCard) => matchingCard.id
    )
  );

  return {
    type: "resolved",

    floorCards: floorCards.filter(
      (floorCard) =>
        !matchingIds.has(floorCard.id)
    ),

    capturedCards: [
      card,
      ...matchingCards,
    ],
  };
}