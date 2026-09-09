import type { HwatuCard } from "../types/game";

export type GostopPlayerIndex = 0 | 1 | 2;

export type GostopPpeokStack = {
  month: number;
  owner: GostopPlayerIndex;
};

export type GostopSpecialEvent =
  | "ppeok"
  | "jjok"
  | "ttadak"
  | "ppeok-capture"
  | "self-ppeok-capture"
  | "bomb"
  | "shake"
  | "bomb-pass";

export type GostopPreparedPlay = {
  owner: GostopPlayerIndex;
  playedCard: HwatuCard;
  matchCount: number;
  matchedCards: HwatuCard[];
  remainingFloorCards: HwatuCard[];
  provisionalFloorCards: HwatuCard[];
  preCapturedCards: HwatuCard[];
  preStealPi: number;
  preSpecialEvents: GostopSpecialEvent[];
  ppeokStacks: GostopPpeokStack[];
};

export type GostopHandPlayResult =
  | {
      type: "choice";
      matchingCards: HwatuCard[];
    }
  | {
      type: "ready";
      prepared: GostopPreparedPlay;
    };

export type GostopDrawChoiceState = {
  type: "choice";
  owner: GostopPlayerIndex;
  drawnCard: HwatuCard;
  matchingCards: HwatuCard[];
  floorCardsBeforeChoice: HwatuCard[];
  capturedBeforeChoice: HwatuCard[];
  stealPiBeforeChoice: number;
  specialEventsBeforeChoice: GostopSpecialEvent[];
  ppeokStacks: GostopPpeokStack[];
};

export type GostopTurnCompleteResult = {
  type: "complete";
  floorCards: HwatuCard[];
  capturedCards: HwatuCard[];
  /**
   * 3인 고스톱에서는 이 값만큼을 "다른 각 플레이어"에게서 가져옵니다.
   * 예: 쪽 stealPi=1 -> 나머지 두 명에게서 각각 피 1개.
   * 자뻑 stealPi=2 -> 나머지 두 명에게서 각각 피 2개.
   */
  stealPi: number;
  specialEvents: GostopSpecialEvent[];
  ppeokStacks: GostopPpeokStack[];
};

export type GostopDrawResult =
  | GostopDrawChoiceState
  | GostopTurnCompleteResult;

export type StealPiResult = {
  remainingCards: HwatuCard[];
  stolenCards: HwatuCard[];
  stolenPiValue: number;
};
export type GostopBombAction = {
  month: number;
  handCards: HwatuCard[];
  floorCard: HwatuCard;
};


function removeCards(cards: HwatuCard[], toRemove: HwatuCard[]) {
  const ids = new Set(toRemove.map((card) => card.id));
  return cards.filter((card) => !ids.has(card.id));
}

function findPpeokStack(
  stacks: GostopPpeokStack[],
  month: number
) {
  return stacks.find((stack) => stack.month === month);
}

function addPpeokStack(
  stacks: GostopPpeokStack[],
  month: number,
  owner: GostopPlayerIndex
): GostopPpeokStack[] {
  return [
    ...stacks.filter((stack) => stack.month !== month),
    { month, owner },
  ];
}

function removePpeokStack(
  stacks: GostopPpeokStack[],
  month: number
) {
  return stacks.filter((stack) => stack.month !== month);
}

function getPpeokCaptureEffect(
  stacks: GostopPpeokStack[],
  month: number,
  currentPlayer: GostopPlayerIndex
): {
  stacks: GostopPpeokStack[];
  stealPi: number;
  events: GostopSpecialEvent[];
} {
  const stack = findPpeokStack(stacks, month);

  if (!stack) {
    return {
      stacks,
      stealPi: 0,
      events: [],
    };
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

export function getGostopSameMonthHandCards(
  handCards: HwatuCard[],
  month: number
): HwatuCard[] {
  return handCards.filter((card) => card.month === month);
}

export function getGostopBombActionForMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[],
  month: number
): GostopBombAction | null {
  const sameHand = getGostopSameMonthHandCards(handCards, month);
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

export function findGostopBombAction(
  handCards: HwatuCard[],
  floorCards: HwatuCard[]
): GostopBombAction | null {
  const months = [...new Set(handCards.map((card) => card.month))];

  for (const month of months) {
    const action = getGostopBombActionForMonth(
      handCards,
      floorCards,
      month
    );

    if (action) return action;
  }

  return null;
}

export function canGostopShakeMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[],
  month: number
): boolean {
  const sameHand = getGostopSameMonthHandCards(handCards, month);
  const sameFloor = floorCards.filter((card) => card.month === month);

  return sameHand.length === 3 && sameFloor.length === 0;
}

export function findGostopShakeMonth(
  handCards: HwatuCard[],
  floorCards: HwatuCard[]
): number | null {
  const months = [...new Set(handCards.map((card) => card.month))];

  for (const month of months) {
    if (canGostopShakeMonth(handCards, floorCards, month)) {
      return month;
    }
  }

  return null;
}

/* =========================
   손패 한 장을 낸 직후 판정
========================= */

export function prepareGostopHandPlay(
  playedCard: HwatuCard,
  floorCards: HwatuCard[],
  owner: GostopPlayerIndex,
  ppeokStacks: GostopPpeokStack[],
  selectedMatchId?: string
): GostopHandPlayResult {
  const matchingCards = floorCards.filter(
    (floorCard) => floorCard.month === playedCard.month
  );

  if (matchingCards.length === 2 && !selectedMatchId) {
    return {
      type: "choice",
      matchingCards,
    };
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

  const remainingFloorCards = removeCards(
    floorCards,
    selectedMatches
  );

  const preCapturedCards =
    selectedMatches.length > 0
      ? [playedCard, ...selectedMatches]
      : [];

  let nextPpeokStacks = [...ppeokStacks];
  let preStealPi = 0;
  let preSpecialEvents: GostopSpecialEvent[] = [];

  // 바닥에 같은 월 3장이 있고 네 번째 패로 먹는 경우.
  // 실제 뻑 스택이었다면 뻑 회수 보너스도 같이 계산합니다.
  if (matchingCards.length >= 3) {
    const effect = getPpeokCaptureEffect(
      nextPpeokStacks,
      playedCard.month,
      owner
    );

    nextPpeokStacks = effect.stacks;
    preStealPi += effect.stealPi;
    preSpecialEvents = [
      ...preSpecialEvents,
      ...effect.events,
    ];
  }

  /*
   * 더미를 뒤집기 전 임시 바닥.
   *
   * - 0장 매칭: 낸 패를 바닥에 실제로 놓습니다.
   * - 1~2장 매칭: 기존 바닥은 유지하고 UI에서 낸 패를 겹쳐 보입니다.
   * - 3장 이상: 네 장을 바로 먹는 상황이므로 해당 월을 임시 바닥에서도 제거합니다.
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

export function finalizeGostopPreparedPlay(
  prepared: GostopPreparedPlay
): GostopTurnCompleteResult {
  return {
    type: "complete",
    floorCards:
      prepared.matchCount === 0
        ? prepared.provisionalFloorCards
        : prepared.remainingFloorCards,
    capturedCards: prepared.preCapturedCards,
    stealPi: prepared.preStealPi,
    specialEvents: prepared.preSpecialEvents,
    ppeokStacks: prepared.ppeokStacks,
  };
}

/* =========================
   손패를 낸 다음 더미 판정
========================= */

export function resolveGostopTurnDraw(
  prepared: GostopPreparedPlay,
  drawnCard: HwatuCard
): GostopDrawResult {
  const sameAsPlayed =
    drawnCard.month === prepared.playedCard.month;

  /* 뻑
   * 바닥 1장 + 손에서 같은 월 + 더미에서도 같은 월
   * -> 세 장을 먹지 못하고 바닥에 묶습니다.
   */
  if (prepared.matchCount === 1 && sameAsPlayed) {
    return {
      type: "complete",
      floorCards: [
        ...prepared.remainingFloorCards,
        ...prepared.matchedCards,
        prepared.playedCard,
        drawnCard,
      ],
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

  /* 쪽
   * 손에서 낸 패가 아무것도 못 먹었는데
   * 더미에서 같은 월이 나와 둘을 먹는 경우.
   */
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

  /* 따닥
   * 바닥에 같은 월 2장이 있고 그 월을 낸 뒤
   * 더미에서 마지막 같은 월이 나오는 경우.
   */
  if (prepared.matchCount === 2 && sameAsPlayed) {
    const leftoverSameMonth =
      prepared.remainingFloorCards.filter(
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
      specialEvents: [
        ...prepared.preSpecialEvents,
        "ttadak",
      ],
      ppeokStacks: prepared.ppeokStacks,
    };
  }

  const baseFloorCards =
    prepared.matchCount === 0
      ? [
          ...prepared.remainingFloorCards,
          prepared.playedCard,
        ]
      : [...prepared.remainingFloorCards];

  return resolveGostopDrawOnly(
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
   더미 카드만 판정
========================= */

export function resolveGostopDrawOnly(
  drawnCard: HwatuCard,
  floorCards: HwatuCard[],
  owner: GostopPlayerIndex,
  ppeokStacks: GostopPpeokStack[],
  capturedBefore: HwatuCard[] = [],
  stealPiBefore = 0,
  eventsBefore: GostopSpecialEvent[] = []
): GostopDrawResult {
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
      capturedCards: [
        ...capturedBefore,
        drawnCard,
        matchingCards[0],
      ],
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
    capturedCards: [
      ...capturedBefore,
      drawnCard,
      ...matchingCards,
    ],
    stealPi: stealPiBefore + ppeokEffect.stealPi,
    specialEvents: [
      ...eventsBefore,
      ...ppeokEffect.events,
    ],
    ppeokStacks: ppeokEffect.stacks,
  };
}

export function resolveGostopDrawChoice(
  choice: GostopDrawChoiceState,
  selectedCard: HwatuCard
): GostopTurnCompleteResult {
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
   피 카드 이동
========================= */

function getPiValue(card: HwatuCard): number {
  if (card.category !== "pi") return 0;
  return card.tags.includes("double-pi") ? 2 : 1;
}

export function stealGostopPiCards(
  cards: HwatuCard[],
  requestedPi: number
): StealPiResult {
  const remainingCards = [...cards];
  const stolenCards: HwatuCard[] = [];

  let remainingPi = requestedPi;
  let stolenPiValue = 0;

  while (remainingPi > 0) {
    // 가능하면 일반 피부터 가져옵니다.
    let index = remainingCards.findIndex(
      (card) => getPiValue(card) === 1
    );

    // 일반 피가 없으면 쌍피를 통째로 가져옵니다.
    if (index === -1) {
      index = remainingCards.findIndex(
        (card) => getPiValue(card) === 2
      );
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
