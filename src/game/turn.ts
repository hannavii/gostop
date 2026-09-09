import type { HwatuCard } from "../types/game";

export type PlayerSide = "player" | "opponent";

export type PpeokStack = {
  month: number;
  owner: PlayerSide;
};

export type SpecialEvent =
  | "ppeok"
  | "jjok"
  | "ttadak"
  | "ppeok-capture"
  | "self-ppeok-capture"
  | "bomb"
  | "shake"
  | "bomb-pass";

export type PreparedPlay = {
  owner: PlayerSide;
  playedCard: HwatuCard;
  matchCount: number;
  matchedCards: HwatuCard[];
  remainingFloorCards: HwatuCard[];
  provisionalFloorCards: HwatuCard[];
  preCapturedCards: HwatuCard[];
  preStealPi: number;
  preSpecialEvents: SpecialEvent[];
  ppeokStacks: PpeokStack[];
};

export type HandPlayResult =
  | {
      type: "choice";
      matchingCards: HwatuCard[];
    }
  | {
      type: "ready";
      prepared: PreparedPlay;
    };

export type DrawChoiceState = {
  type: "choice";
  owner: PlayerSide;
  drawnCard: HwatuCard;
  matchingCards: HwatuCard[];
  floorCardsBeforeChoice: HwatuCard[];
  capturedBeforeChoice: HwatuCard[];
  stealPiBeforeChoice: number;
  specialEventsBeforeChoice: SpecialEvent[];
  ppeokStacks: PpeokStack[];
};

export type TurnCompleteResult = {
  type: "complete";
  floorCards: HwatuCard[];
  capturedCards: HwatuCard[];
  stealPi: number;
  specialEvents: SpecialEvent[];
  ppeokStacks: PpeokStack[];
};

export type DrawResult = DrawChoiceState | TurnCompleteResult;

export type StealPiResult = {
  remainingCards: HwatuCard[];
  stolenCards: HwatuCard[];
  stolenPiValue: number;
};

export type BombAction = {
  month: number;
  handCards: HwatuCard[];
  floorCard: HwatuCard;
};

function removeCards(cards: HwatuCard[], toRemove: HwatuCard[]) {
  const ids = new Set(toRemove.map((card) => card.id));
  return cards.filter((card) => !ids.has(card.id));
}

function findPpeokStack(stacks: PpeokStack[], month: number) {
  return stacks.find((stack) => stack.month === month);
}

function addPpeokStack(
  stacks: PpeokStack[],
  month: number,
  owner: PlayerSide
): PpeokStack[] {
  return [
    ...stacks.filter((stack) => stack.month !== month),
    { month, owner },
  ];
}

function removePpeokStack(stacks: PpeokStack[], month: number) {
  return stacks.filter((stack) => stack.month !== month);
}

function getPpeokCaptureEffect(
  stacks: PpeokStack[],
  month: number,
  currentPlayer: PlayerSide
): {
  stacks: PpeokStack[];
  stealPi: number;
  events: SpecialEvent[];
} {
  const stack = findPpeokStack(stacks, month);

  if (!stack) {
    return { stacks, stealPi: 0, events: [] };
  }

  const nextStacks = removePpeokStack(stacks, month);

  if (stack.owner === currentPlayer) {
    return {
      stacks: nextStacks,
      stealPi: 2,
      events: ["self-ppeok-capture"],
    };
  }

  return {
    stacks: nextStacks,
    stealPi: 1,
    events: ["ppeok-capture"],
  };
}

/* =========================
   폭탄 / 흔들기 후보 찾기
========================= */

export function getSameMonthHandCards(
  handCards: HwatuCard[],
  month: number
): HwatuCard[] {
  return handCards.filter((card) => card.month === month);
}

export function getBombActionForMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[],
  month: number
): BombAction | null {
  const sameHand = getSameMonthHandCards(handCards, month);
  const sameFloor = floorCards.filter((card) => card.month === month);

  if (sameHand.length !== 3 || sameFloor.length !== 1) {
    return null;
  }

  return {
    month,
    handCards: sameHand,
    floorCard: sameFloor[0],
  };
}

export function findBombAction(
  handCards: HwatuCard[],
  floorCards: HwatuCard[]
): BombAction | null {
  const months = [...new Set(handCards.map((card) => card.month))];

  for (const month of months) {
    const action = getBombActionForMonth(handCards, floorCards, month);
    if (action) return action;
  }

  return null;
}

export function canShakeMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[],
  month: number
): boolean {
  const sameHand = getSameMonthHandCards(handCards, month);
  const sameFloor = floorCards.filter((card) => card.month === month);

  return sameHand.length === 3 && sameFloor.length === 0;
}

export function findShakeMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[]
): number | null {
  const months = [...new Set(handCards.map((card) => card.month))];

  for (const month of months) {
    if (canShakeMonth(handCards, floorCards, month)) {
      return month;
    }
  }

  return null;
}

/* =========================
   손패 1장 처리
========================= */

export function prepareHandPlay(
  playedCard: HwatuCard,
  floorCards: HwatuCard[],
  owner: PlayerSide,
  ppeokStacks: PpeokStack[],
  selectedMatchId?: string
): HandPlayResult {
  const matchingCards = floorCards.filter(
    (floorCard) => floorCard.month === playedCard.month
  );

  if (matchingCards.length === 2 && !selectedMatchId) {
    return { type: "choice", matchingCards };
  }

  let selectedMatches: HwatuCard[] = [];

  if (matchingCards.length === 1) {
    selectedMatches = [matchingCards[0]];
  } else if (matchingCards.length === 2) {
    const selected = matchingCards.find(
      (card) => card.id === selectedMatchId
    );
    selectedMatches = [selected ?? matchingCards[0]];
  } else if (matchingCards.length >= 3) {
    selectedMatches = [...matchingCards];
  }

  const remainingFloorCards = removeCards(floorCards, selectedMatches);

  const preCapturedCards =
    selectedMatches.length > 0
      ? [playedCard, ...selectedMatches]
      : [];

  let nextPpeokStacks = [...ppeokStacks];
  let preStealPi = 0;
  let preSpecialEvents: SpecialEvent[] = [];

  if (matchingCards.length >= 3) {
    const effect = getPpeokCaptureEffect(
      nextPpeokStacks,
      playedCard.month,
      owner
    );

    nextPpeokStacks = effect.stacks;
    preStealPi += effect.stealPi;
    preSpecialEvents = [...preSpecialEvents, ...effect.events];
  }

  /*
   * 더미를 뒤집기 전 임시 바닥 상태.
   *
   * - 매칭 0장: 낸 카드를 실제 바닥에 놓습니다.
   * - 매칭 1~2장: 기존 바닥은 그대로 두고, App에서 낸 카드를
   *   선택된 바닥패 위에 겹쳐서 표시합니다.
   * - 매칭 3장 이상: 네 번째 패를 낸 것이므로 해당 월은 바로 빠집니다.
   */
  const provisionalFloorCards =
    matchingCards.length === 0
      ? [...floorCards, playedCard]
      : matchingCards.length >= 3
        ? remainingFloorCards
        : [...floorCards];

  return {
    type: "ready",
    prepared: {
      owner,
      playedCard,
      matchCount: matchingCards.length,
      matchedCards: selectedMatches,
      remainingFloorCards,
      provisionalFloorCards,
      preCapturedCards,
      preStealPi,
      preSpecialEvents,
      ppeokStacks: nextPpeokStacks,
    },
  };
}

export function finalizePreparedPlay(
  prepared: PreparedPlay
): TurnCompleteResult {
  if (prepared.matchCount === 0) {
    return {
      type: "complete",
      floorCards: prepared.provisionalFloorCards,
      capturedCards: prepared.preCapturedCards,
      stealPi: prepared.preStealPi,
      specialEvents: prepared.preSpecialEvents,
      ppeokStacks: prepared.ppeokStacks,
    };
  }

  return {
    type: "complete",
    floorCards: prepared.remainingFloorCards,
    capturedCards: prepared.preCapturedCards,
    stealPi: prepared.preStealPi,
    specialEvents: prepared.preSpecialEvents,
    ppeokStacks: prepared.ppeokStacks,
  };
}

/* =========================
   일반 턴의 더미 처리
========================= */

export function resolveTurnDraw(
  prepared: PreparedPlay,
  drawnCard: HwatuCard
): DrawResult {
  const sameAsPlayed = drawnCard.month === prepared.playedCard.month;

  /* 뻑 */
  if (prepared.matchCount === 1 && sameAsPlayed) {
    const nextFloorCards = [
      ...prepared.remainingFloorCards,
      ...prepared.matchedCards,
      prepared.playedCard,
      drawnCard,
    ];

    return {
      type: "complete",
      floorCards: nextFloorCards,
      capturedCards: [],
      stealPi: 0,
      specialEvents: ["ppeok"],
      ppeokStacks: addPpeokStack(
        prepared.ppeokStacks,
        prepared.playedCard.month,
        prepared.owner
      ),
    };
  }

  /* 쪽 */
  if (prepared.matchCount === 0 && sameAsPlayed) {
    return {
      type: "complete",
      floorCards: prepared.remainingFloorCards,
      capturedCards: [prepared.playedCard, drawnCard],
      stealPi: 1,
      specialEvents: ["jjok"],
      ppeokStacks: prepared.ppeokStacks,
    };
  }

  /* 따닥 */
  if (prepared.matchCount === 2 && sameAsPlayed) {
    const leftoverSameMonth = prepared.remainingFloorCards.filter(
      (card) => card.month === prepared.playedCard.month
    );

    return {
      type: "complete",
      floorCards: removeCards(
        prepared.remainingFloorCards,
        leftoverSameMonth
      ),
      capturedCards: [
        prepared.playedCard,
        ...prepared.matchedCards,
        ...leftoverSameMonth,
        drawnCard,
      ],
      stealPi: prepared.preStealPi + 1,
      specialEvents: [...prepared.preSpecialEvents, "ttadak"],
      ppeokStacks: prepared.ppeokStacks,
    };
  }

  const baseFloorCards =
    prepared.matchCount === 0
      ? [...prepared.remainingFloorCards, prepared.playedCard]
      : [...prepared.remainingFloorCards];

  return resolveDrawOnly(
    drawnCard,
    baseFloorCards,
    prepared.owner,
    prepared.ppeokStacks,
    prepared.preCapturedCards,
    prepared.preStealPi,
    prepared.preSpecialEvents
  );
}

/* =========================
   폭탄패 / 폭탄 직후처럼
   손패를 내지 않고 더미만 뒤집는 경우
========================= */

export function resolveDrawOnly(
  drawnCard: HwatuCard,
  floorCards: HwatuCard[],
  owner: PlayerSide,
  ppeokStacks: PpeokStack[],
  capturedBefore: HwatuCard[] = [],
  stealPiBefore = 0,
  eventsBefore: SpecialEvent[] = []
): DrawResult {
  const matchingCards = floorCards.filter(
    (floorCard) => floorCard.month === drawnCard.month
  );

  if (matchingCards.length === 0) {
    return {
      type: "complete",
      floorCards: [...floorCards, drawnCard],
      capturedCards: capturedBefore,
      stealPi: stealPiBefore,
      specialEvents: eventsBefore,
      ppeokStacks,
    };
  }

  if (matchingCards.length === 1) {
    return {
      type: "complete",
      floorCards: removeCards(floorCards, matchingCards),
      capturedCards: [...capturedBefore, drawnCard, matchingCards[0]],
      stealPi: stealPiBefore,
      specialEvents: eventsBefore,
      ppeokStacks,
    };
  }

  if (matchingCards.length === 2) {
    return {
      type: "choice",
      owner,
      drawnCard,
      matchingCards,
      floorCardsBeforeChoice: floorCards,
      capturedBeforeChoice: capturedBefore,
      stealPiBeforeChoice: stealPiBefore,
      specialEventsBeforeChoice: eventsBefore,
      ppeokStacks,
    };
  }

  const ppeokEffect = getPpeokCaptureEffect(
    ppeokStacks,
    drawnCard.month,
    owner
  );

  return {
    type: "complete",
    floorCards: removeCards(floorCards, matchingCards),
    capturedCards: [...capturedBefore, drawnCard, ...matchingCards],
    stealPi: stealPiBefore + ppeokEffect.stealPi,
    specialEvents: [...eventsBefore, ...ppeokEffect.events],
    ppeokStacks: ppeokEffect.stacks,
  };
}

export function resolveDrawChoice(
  choice: DrawChoiceState,
  selectedCard: HwatuCard
): TurnCompleteResult {
  const canSelect = choice.matchingCards.some(
    (card) => card.id === selectedCard.id
  );

  if (!canSelect) {
    return {
      type: "complete",
      floorCards: choice.floorCardsBeforeChoice,
      capturedCards: choice.capturedBeforeChoice,
      stealPi: choice.stealPiBeforeChoice,
      specialEvents: choice.specialEventsBeforeChoice,
      ppeokStacks: choice.ppeokStacks,
    };
  }

  return {
    type: "complete",
    floorCards: choice.floorCardsBeforeChoice.filter(
      (card) => card.id !== selectedCard.id
    ),
    capturedCards: [
      ...choice.capturedBeforeChoice,
      choice.drawnCard,
      selectedCard,
    ],
    stealPi: choice.stealPiBeforeChoice,
    specialEvents: choice.specialEventsBeforeChoice,
    ppeokStacks: choice.ppeokStacks,
  };
}

/* =========================
   상대 피 가져오기
========================= */

function getPiValue(card: HwatuCard): number {
  if (card.category !== "pi") return 0;
  return card.tags.includes("double-pi") ? 2 : 1;
}

export function stealPiCards(
  cards: HwatuCard[],
  requestedPi: number
): StealPiResult {
  const remainingCards = [...cards];
  const stolenCards: HwatuCard[] = [];

  let remainingPi = requestedPi;
  let stolenPiValue = 0;

  while (remainingPi > 0) {
    let index = remainingCards.findIndex((card) => getPiValue(card) === 1);

    if (index === -1) {
      index = remainingCards.findIndex((card) => getPiValue(card) === 2);
    }

    if (index === -1) break;

    const [stolenCard] = remainingCards.splice(index, 1);
    const value = getPiValue(stolenCard);

    stolenCards.push(stolenCard);
    stolenPiValue += value;
    remainingPi -= value;
  }

  return {
    remainingCards,
    stolenCards,
    stolenPiValue,
  };
}
