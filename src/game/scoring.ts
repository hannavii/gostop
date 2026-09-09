import type { HwatuCard } from "../types/game";

export type ScoreResult = {
  total: number;

  gwangScore: number;
  animalScore: number;
  ribbonScore: number;
  piScore: number;

  gwangCount: number;
  animalCount: number;
  ribbonCount: number;
  piCount: number;

  godori: boolean;
  hongdan: boolean;
  cheongdan: boolean;
  chodan: boolean;

  sakeCupAsPi: boolean;
};

function hasTag(
  card: HwatuCard,
  tag: HwatuCard["tags"][number]
) {
  return card.tags.includes(tag);
}

/* =========================
   광 점수
========================= */

function calculateGwangScore(
  cards: HwatuCard[]
): number {
  const gwangCards = cards.filter(
    (card) => card.category === "gwang"
  );

  const count = gwangCards.length;

  if (count === 5) {
    return 15;
  }

  if (count === 4) {
    return 4;
  }

  if (count === 3) {
    const hasRainGwang =
      gwangCards.some((card) =>
        hasTag(card, "rain-gwang")
      );

    return hasRainGwang ? 2 : 3;
  }

  return 0;
}

/* =========================
   열끗 점수
========================= */

function calculateAnimalScore(
  animalCards: HwatuCard[]
): number {
  let score = 0;

  if (animalCards.length >= 5) {
    score += animalCards.length - 4;
  }

  const godoriCount =
    animalCards.filter((card) =>
      hasTag(card, "godori")
    ).length;

  if (godoriCount === 3) {
    score += 5;
  }

  return score;
}

/* =========================
   띠 점수
========================= */

function calculateRibbonScore(
  cards: HwatuCard[]
): number {
  const ribbons = cards.filter(
    (card) => card.category === "ribbon"
  );

  let score = 0;

  if (ribbons.length >= 5) {
    score += ribbons.length - 4;
  }

  const hongdanCount =
    ribbons.filter((card) =>
      hasTag(card, "hongdan")
    ).length;

  const cheongdanCount =
    ribbons.filter((card) =>
      hasTag(card, "cheongdan")
    ).length;

  const chodanCount =
    ribbons.filter((card) =>
      hasTag(card, "chodan")
    ).length;

  if (hongdanCount === 3) {
    score += 3;
  }

  if (cheongdanCount === 3) {
    score += 3;
  }

  if (chodanCount === 3) {
    score += 3;
  }

  return score;
}

/* =========================
   피 개수
========================= */

function getPiCount(
  cards: HwatuCard[]
): number {
  return cards.reduce(
    (total, card) => {
      if (card.category !== "pi") {
        return total;
      }

      if (hasTag(card, "double-pi")) {
        return total + 2;
      }

      return total + 1;
    },
    0
  );
}

function calculatePiScore(
  piCount: number
): number {
  if (piCount < 10) {
    return 0;
  }

  return piCount - 9;
}

/* =========================
   전체 점수
========================= */

export function calculateScore(
  cards: HwatuCard[]
): ScoreResult {
  const gwangCards = cards.filter(
    (card) =>
      card.category === "gwang"
  );

  const normalAnimalCards =
    cards.filter(
      (card) =>
        card.category === "animal"
    );

  const ribbonCards =
    cards.filter(
      (card) =>
        card.category === "ribbon"
    );

  const sakeCup =
    cards.find((card) =>
      hasTag(card, "sake-cup")
    );

  /*
   * 9월 술잔 카드는
   * 열끗 또는 쌍피로 사용할 수 있으므로
   * 두 경우의 점수를 계산해서
   * 더 높은 쪽을 사용한다.
   */

  const animalOptionCards =
    normalAnimalCards;

  const animalOptionScore =
    calculateAnimalScore(
      animalOptionCards
    );

  const normalPiCount =
    getPiCount(cards);

  const animalOptionPiScore =
    calculatePiScore(
      normalPiCount
    );

  let sakeCupAsPi = false;

  let finalAnimalCards =
    animalOptionCards;

  let finalAnimalScore =
    animalOptionScore;

  let finalPiCount =
    normalPiCount;

  let finalPiScore =
    animalOptionPiScore;

  if (sakeCup) {
    const animalsWithoutSakeCup =
      normalAnimalCards.filter(
        (card) =>
          card.id !== sakeCup.id
      );

    const sakeAsPiAnimalScore =
      calculateAnimalScore(
        animalsWithoutSakeCup
      );

    const sakeAsPiCount =
      normalPiCount + 2;

    const sakeAsPiPiScore =
      calculatePiScore(
        sakeAsPiCount
      );

    const animalModeTotal =
      animalOptionScore +
      animalOptionPiScore;

    const piModeTotal =
      sakeAsPiAnimalScore +
      sakeAsPiPiScore;

    if (piModeTotal > animalModeTotal) {
      sakeCupAsPi = true;

      finalAnimalCards =
        animalsWithoutSakeCup;

      finalAnimalScore =
        sakeAsPiAnimalScore;

      finalPiCount =
        sakeAsPiCount;

      finalPiScore =
        sakeAsPiPiScore;
    }
  }

  const gwangScore =
    calculateGwangScore(cards);

  const ribbonScore =
    calculateRibbonScore(cards);

  const total =
    gwangScore +
    finalAnimalScore +
    ribbonScore +
    finalPiScore;

  return {
    total,

    gwangScore,
    animalScore: finalAnimalScore,
    ribbonScore,
    piScore: finalPiScore,

    gwangCount:
      gwangCards.length,

    animalCount:
      finalAnimalCards.length,

    ribbonCount:
      ribbonCards.length,

    piCount:
      finalPiCount,

    godori:
      finalAnimalCards.filter(
        (card) =>
          hasTag(card, "godori")
      ).length === 3,

    hongdan:
      ribbonCards.filter(
        (card) =>
          hasTag(card, "hongdan")
      ).length === 3,

    cheongdan:
      ribbonCards.filter(
        (card) =>
          hasTag(card, "cheongdan")
      ).length === 3,

    chodan:
      ribbonCards.filter(
        (card) =>
          hasTag(card, "chodan")
      ).length === 3,

    sakeCupAsPi,
  };
}