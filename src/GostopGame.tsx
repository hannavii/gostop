import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import "./App.css";

import Card from "./components/Card";
import CapturedCardsModal from "./components/CapturedCardsModal";
import { hwatuCards } from "./data/cards";
import { dealGostopCards } from "./game/deal";
import { GAME_RULES } from "./game/rules";
import { calculateScore } from "./game/scoring";
import {
  calculateGostopSettlement,
  type GostopSettlementResult,
} from "./game/gostopSettlement";
import {
  applyGostopPansseul,
  canGostopShakeMonth,
  finalizeGostopPreparedPlay,
  findGostopBombAction,
  findGostopShakeMonth,
  getGostopBombActionForMonth,
  prepareGostopHandPlay,
  resolveGostopDrawChoice,
  resolveGostopDrawOnly,
  resolveGostopTurnDraw,
  stealGostopPiCards,
  type GostopDrawChoiceState,
  type GostopPpeokStack,
  type GostopPreparedPlay,
  type GostopSpecialEvent,
  type GostopTurnCompleteResult,
} from "./game/gostopTurn";
import type { HwatuCard } from "./types/game";

type PlayerIndex = 0 | 1 | 2;
type GameResult = PlayerIndex | "draw" | null;

type PendingChoice =
  | {
      type: "hand";
      playedCard: HwatuCard;
      matchingCards: HwatuCard[];
    }
  | {
      type: "draw";
      matchingCards: HwatuCard[];
      choice: GostopDrawChoiceState;
    };


type SpecialActionPrompt =
  | {
      type: "bomb";
      card: HwatuCard;
      month: number;
    }
  | {
      type: "shake";
      card: HwatuCard;
      month: number;
    };

type FlyingCardKind =
  | "player-play"
  | "player-draw"
  | "opponent-play"
  | "opponent-draw";

type FlyingCardState = {
  card: HwatuCard;
  kind: FlyingCardKind;
  startsFaceDown: boolean;
  faceUp: boolean;
};

type PendingPlayedVisual = {
  card: HwatuCard;
  targetCardId: string;
  owner: PlayerIndex;
};

type CaptureFlightState = {
  cards: HwatuCard[];
  owner: PlayerIndex;
};

type FloorDisplayItem =
  | {
      type: "card";
      card: HwatuCard;
    }
  | {
      type: "ppeok";
      month: number;
      cards: HwatuCard[];
      owner: PlayerIndex;
    };

type ScoreResult = ReturnType<typeof calculateScore>;

type CapturedPanelProps = {
  title: string;
  cards: HwatuCard[];
  score: ScoreResult;
  position: "opponent1" | "opponent2" | "player";
  goCount: number;
  shakeCount: number;
  shakeMonths: number[];
  bombCount: number;
  onOpenDetails: () => void;
};

const GO_STOP_SCORE = GAME_RULES.gostop.goStopScore;

/* =========================================
   2인 맞고와 같은 속도 설정
========================================= */

const GAME_SPEED = {
  playerPlay: 750,
  opponentPlay: 800,
  drawMove: 650,
  revealHold: 700,
  flip: 280,
  captureMove: 750,
  stackIn: 300,
  shakeReveal: 1200,
  specialEffect: 900,
  resultPause: 400,
  bombPause: 300,
  opponentThink: 800,
  opponentAfterAction: 500,
  opponentStopHold: 900,
  opponentTurnDelay: 650,
} as const;

const GAME_SPEED_STYLE = {
  "--player-play-duration": `${GAME_SPEED.playerPlay}ms`,
  "--opponent-play-duration": `${GAME_SPEED.opponentPlay}ms`,
  "--draw-flight-duration": `${GAME_SPEED.drawMove}ms`,
  "--flip-duration": `${GAME_SPEED.flip}ms`,
  "--capture-flight-duration": `${GAME_SPEED.captureMove}ms`,
  "--stack-in-duration": `${GAME_SPEED.stackIn}ms`,
  "--special-effect-duration": `${GAME_SPEED.specialEffect}ms`,
} as CSSProperties;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getPlayerName(index: PlayerIndex) {
  if (index === 0) return "나";
  return `상대 ${index}`;
}

function getCapturedCardLabel(card: HwatuCard): string {
  if (card.category === "gwang") {
    return card.tags.includes("rain-gwang") ? "비광" : "광";
  }

  if (card.category === "animal") {
    if (card.tags.includes("godori")) return "고";
    if (card.tags.includes("sake-cup")) return "술";
    return "열";
  }

  if (card.category === "ribbon") {
    if (card.tags.includes("hongdan")) return "홍";
    if (card.tags.includes("cheongdan")) return "청";
    if (card.tags.includes("chodan")) return "초";
    return "띠";
  }

  return card.tags.includes("double-pi") ? "쌍" : "피";
}

function getSpecialEventName(event: GostopSpecialEvent) {
  switch (event) {
    case "ppeok":
      return "뻑!";
    case "jjok":
      return "쪽!";
    case "ttadak":
      return "따닥!";
    case "pansseul":
      return "판쓸!";
    case "ppeok-capture":
      return "뻑 먹기!";
    case "self-ppeok-capture":
      return "자뻑 회수!";
    case "bomb":
      return "폭탄!";
    case "shake":
      return "흔들기!";
    case "bomb-pass":
      return "폭탄 패!";
    default:
      return "";
  }
}

function CapturedPanel({
  title,
  cards,
  score,
  position,
  goCount,
  shakeCount,
  shakeMonths,
  bombCount,
  onOpenDetails,
}: CapturedPanelProps) {
  const gwangCards = cards.filter((card) => card.category === "gwang");
  const animalCards = cards.filter((card) => card.category === "animal");
  const ribbonCards = cards.filter((card) => card.category === "ribbon");
  const piCards = cards.filter((card) => card.category === "pi");

  const groups = [
    { name: "광", cards: gwangCards },
    { name: "열끗", cards: animalCards },
    { name: "띠", cards: ribbonCards },
    { name: "피", cards: piCards },
  ];

  const badges: string[] = [];

  if (score.godori) badges.push("고도리");
  if (score.hongdan) badges.push("홍단");
  if (score.cheongdan) badges.push("청단");
  if (score.chodan) badges.push("초단");

  if (score.gwangScore > 0) {
    const hasRainGwang = gwangCards.some((card) =>
      card.tags.includes("rain-gwang")
    );

    if (score.gwangCount === 3 && hasRainGwang) {
      badges.push("비삼광");
    } else {
      badges.push(`${score.gwangCount}광`);
    }
  }

  if (score.sakeCupAsPi) badges.push("술잔→쌍피");
  if (goCount > 0) badges.push(`${goCount} GO`);
  if (shakeCount > 0) badges.push(`흔들기 ${shakeCount}회`);
  if (bombCount > 0) badges.push(`폭탄 ${bombCount}회`);

  return (
    <aside
      className={`captured-panel captured-panel--clickable gostop3-captured-panel gostop3-captured-panel--${position}`}
      role="button"
      tabIndex={0}
      aria-label={`${title} 자세히 보기`}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails();
        }
      }}
    >
      <div className="captured-panel-header">
        <strong>{title}</strong>
        <span>{cards.length}장</span>
      </div>

      <div className="captured-groups">
        {groups.map((group) => (
          <div key={group.name} className="captured-row">
            <span className="captured-row-name">{group.name}</span>

            <div className="captured-card-stack">
              {group.cards.length === 0 ? (
                <span className="captured-empty">-</span>
              ) : (
                group.cards.map((card) => (
                  <div
                    key={card.id}
                    className={`captured-mini-card captured-mini-card--${card.category}`}
                    title={`${card.month}월 ${getCapturedCardLabel(card)}`}
                  >
                    <span>{card.month}</span>
                    <strong>{getCapturedCardLabel(card)}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {badges.length > 0 && (
        <div className="captured-badges">
          {badges.map((badge) => (
            <span key={badge} className="captured-badge">
              {badge}
            </span>
          ))}
        </div>
      )}

      {shakeMonths.length > 0 && (
        <div className="shake-records">
          <span className="shake-records-label">흔들기 공개</span>
          <div className="shake-record-list">
            {shakeMonths.map((month, index) => (
              <span key={`${month}-${index}`} className="shake-record-chip">
                {month}월 ×3
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="captured-panel-detail-hint">클릭해서 전체 패 보기</div>

      <div className="captured-score">
        <span>현재 점수</span>
        <strong>{score.total}점</strong>
      </div>
    </aside>
  );
}

function GostopGame() {
  const [playerCards, setPlayerCards] = useState<HwatuCard[]>([]);
  const [opponent1Cards, setOpponent1Cards] = useState<HwatuCard[]>([]);
  const [opponent2Cards, setOpponent2Cards] = useState<HwatuCard[]>([]);

  const [floorCards, setFloorCards] = useState<HwatuCard[]>([]);
  const [drawPile, setDrawPile] = useState<HwatuCard[]>([]);

  const [playerCapturedCards, setPlayerCapturedCards] = useState<HwatuCard[]>([]);
  const [opponent1CapturedCards, setOpponent1CapturedCards] =
    useState<HwatuCard[]>([]);
  const [opponent2CapturedCards, setOpponent2CapturedCards] =
    useState<HwatuCard[]>([]);

  const [currentPlayer, setCurrentPlayer] = useState<PlayerIndex>(0);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [specialActionPrompt, setSpecialActionPrompt] =
    useState<SpecialActionPrompt | null>(null);
  const [capturedDetailTarget, setCapturedDetailTarget] =
    useState<PlayerIndex | null>(null);
  const [turnMessage, setTurnMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const [flyingCard, setFlyingCard] = useState<FlyingCardState | null>(null);
  const [pendingPlayedVisual, setPendingPlayedVisual] =
    useState<PendingPlayedVisual | null>(null);
  const [captureFlight, setCaptureFlight] =
    useState<CaptureFlightState | null>(null);

  const [ppeokStacks, setPpeokStacks] = useState<GostopPpeokStack[]>([]);
  const [expandedPpeokMonth, setExpandedPpeokMonth] =
    useState<number | null>(null);
  const [specialEffect, setSpecialEffect] = useState<string | null>(null);

  /* =========================
     3인 GO / STOP
  ========================= */

  const [showGoStop, setShowGoStop] = useState(false);

  const [playerGoCount, setPlayerGoCount] = useState(0);
  const [opponent1GoCount, setOpponent1GoCount] = useState(0);
  const [opponent2GoCount, setOpponent2GoCount] = useState(0);

  const [lastPlayerGoScore, setLastPlayerGoScore] = useState(0);
  const [lastOpponent1GoScore, setLastOpponent1GoScore] = useState(0);
  const [lastOpponent2GoScore, setLastOpponent2GoScore] = useState(0);

  const [playerShakeCount, setPlayerShakeCount] = useState(0);
  const [opponent1ShakeCount, setOpponent1ShakeCount] = useState(0);
  const [opponent2ShakeCount, setOpponent2ShakeCount] = useState(0);

  const [playerShakeMonths, setPlayerShakeMonths] = useState<number[]>([]);
  const [opponent1ShakeMonths, setOpponent1ShakeMonths] = useState<number[]>([]);
  const [opponent2ShakeMonths, setOpponent2ShakeMonths] = useState<number[]>([]);

  const [playerBombCount, setPlayerBombCount] = useState(0);
  const [opponent1BombCount, setOpponent1BombCount] = useState(0);
  const [opponent2BombCount, setOpponent2BombCount] = useState(0);

  const [playerBombPassCount, setPlayerBombPassCount] = useState(0);
  const [opponent1BombPassCount, setOpponent1BombPassCount] = useState(0);
  const [opponent2BombPassCount, setOpponent2BombPassCount] = useState(0);

  /* =========================
     종료
  ========================= */

  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult>(null);
  const [finalMessage, setFinalMessage] = useState("");
  const [settlement, setSettlement] =
    useState<GostopSettlementResult | null>(null);

  /* =========================
     refs
  ========================= */

  const playerCardsRef = useRef(playerCards);
  const opponent1CardsRef = useRef(opponent1Cards);
  const opponent2CardsRef = useRef(opponent2Cards);

  const floorCardsRef = useRef(floorCards);
  const drawPileRef = useRef(drawPile);

  const playerCapturedCardsRef = useRef(playerCapturedCards);
  const opponent1CapturedCardsRef = useRef(opponent1CapturedCards);
  const opponent2CapturedCardsRef = useRef(opponent2CapturedCards);

  const ppeokStacksRef = useRef(ppeokStacks);

  const playerGoCountRef = useRef(playerGoCount);
  const opponent1GoCountRef = useRef(opponent1GoCount);
  const opponent2GoCountRef = useRef(opponent2GoCount);

  const lastPlayerGoScoreRef = useRef(lastPlayerGoScore);
  const lastOpponent1GoScoreRef = useRef(lastOpponent1GoScore);
  const lastOpponent2GoScoreRef = useRef(lastOpponent2GoScore);

  const playerShakeCountRef = useRef(playerShakeCount);
  const opponent1ShakeCountRef = useRef(opponent1ShakeCount);
  const opponent2ShakeCountRef = useRef(opponent2ShakeCount);

  const playerShakeMonthsRef = useRef(playerShakeMonths);
  const opponent1ShakeMonthsRef = useRef(opponent1ShakeMonths);
  const opponent2ShakeMonthsRef = useRef(opponent2ShakeMonths);

  const playerBombCountRef = useRef(playerBombCount);
  const opponent1BombCountRef = useRef(opponent1BombCount);
  const opponent2BombCountRef = useRef(opponent2BombCount);

  const playerBombPassCountRef = useRef(playerBombPassCount);
  const opponent1BombPassCountRef = useRef(opponent1BombPassCount);
  const opponent2BombPassCountRef = useRef(opponent2BombPassCount);

  playerCardsRef.current = playerCards;
  opponent1CardsRef.current = opponent1Cards;
  opponent2CardsRef.current = opponent2Cards;

  floorCardsRef.current = floorCards;
  drawPileRef.current = drawPile;

  playerCapturedCardsRef.current = playerCapturedCards;
  opponent1CapturedCardsRef.current = opponent1CapturedCards;
  opponent2CapturedCardsRef.current = opponent2CapturedCards;

  ppeokStacksRef.current = ppeokStacks;

  playerGoCountRef.current = playerGoCount;
  opponent1GoCountRef.current = opponent1GoCount;
  opponent2GoCountRef.current = opponent2GoCount;

  lastPlayerGoScoreRef.current = lastPlayerGoScore;
  lastOpponent1GoScoreRef.current = lastOpponent1GoScore;
  lastOpponent2GoScoreRef.current = lastOpponent2GoScore;

  playerShakeCountRef.current = playerShakeCount;
  opponent1ShakeCountRef.current = opponent1ShakeCount;
  opponent2ShakeCountRef.current = opponent2ShakeCount;

  playerShakeMonthsRef.current = playerShakeMonths;
  opponent1ShakeMonthsRef.current = opponent1ShakeMonths;
  opponent2ShakeMonthsRef.current = opponent2ShakeMonths;

  playerBombCountRef.current = playerBombCount;
  opponent1BombCountRef.current = opponent1BombCount;
  opponent2BombCountRef.current = opponent2BombCount;

  playerBombPassCountRef.current = playerBombPassCount;
  opponent1BombPassCountRef.current = opponent1BombPassCount;
  opponent2BombPassCountRef.current = opponent2BombPassCount;

  const isRoundExhausted = () =>
    playerCardsRef.current.length === 0 &&
    opponent1CardsRef.current.length === 0 &&
    opponent2CardsRef.current.length === 0 &&
    drawPileRef.current.length === 0;

  const animateFlyingCard = async (
    card: HwatuCard,
    kind: FlyingCardKind,
    startsFaceDown: boolean
  ) => {
    setFlyingCard({
      card,
      kind,
      startsFaceDown,
      faceUp: !startsFaceDown,
    });

    if (!startsFaceDown) {
      await sleep(GAME_SPEED.playerPlay);
      setFlyingCard(null);
      return;
    }

    const moveDuration =
      kind === "opponent-play"
        ? GAME_SPEED.opponentPlay
        : GAME_SPEED.drawMove;

    await sleep(moveDuration);

    setFlyingCard((prev) =>
      prev
        ? {
            ...prev,
            faceUp: true,
          }
        : null
    );

    await sleep(GAME_SPEED.revealHold);
    setFlyingCard(null);
  };

  const animateCapturedCards = async (
    owner: PlayerIndex,
    cards: HwatuCard[]
  ) => {
    if (cards.length === 0) return;

    setCaptureFlight({ owner, cards });
    await sleep(GAME_SPEED.captureMove);
    setCaptureFlight(null);
  };

  const showShakeReveal = async (owner: PlayerIndex, month: number) => {
    const subject = owner === 0 ? "흔들기!" : `상대 ${owner} 흔들기!`;

    setSpecialEffect(`${subject} ${month}월 ×3 공개`);
    setTurnMessage(`${subject} ${month}월 카드 3장을 공개했습니다.`);

    await sleep(GAME_SPEED.shakeReveal);
    setSpecialEffect(null);
  };

  const showSpecialEvents = async (
    events: GostopSpecialEvent[],
    requestedPi: number,
    stolenPiValue: number
  ) => {
    if (events.length === 0) return;

    const names = events
      .map(getSpecialEventName)
      .filter(Boolean)
      .join(" + ");

    let detail = "";

    if (requestedPi > 0 && stolenPiValue > 0) {
      detail = ` · 다른 플레이어에게서 피 ${stolenPiValue}개 획득`;
    } else if (requestedPi > 0) {
      detail = " · 가져올 피가 없습니다.";
    }

    setSpecialEffect(names);
    setTurnMessage(`${names}${detail}`);

    await sleep(GAME_SPEED.specialEffect);
    setSpecialEffect(null);
  };

  const getCapturedRef = (index: PlayerIndex) => {
    if (index === 0) return playerCapturedCardsRef;
    if (index === 1) return opponent1CapturedCardsRef;
    return opponent2CapturedCardsRef;
  };

  const setCapturedForPlayer = (
    index: PlayerIndex,
    cards: HwatuCard[]
  ) => {
    getCapturedRef(index).current = cards;

    if (index === 0) {
      setPlayerCapturedCards(cards);
    } else if (index === 1) {
      setOpponent1CapturedCards(cards);
    } else {
      setOpponent2CapturedCards(cards);
    }
  };

  const getBombPassCount = (index: PlayerIndex) => {
    if (index === 0) return playerBombPassCountRef.current;
    if (index === 1) return opponent1BombPassCountRef.current;
    return opponent2BombPassCountRef.current;
  };

  const setBombPassCountForPlayer = (index: PlayerIndex, count: number) => {
    if (index === 0) {
      playerBombPassCountRef.current = count;
      setPlayerBombPassCount(count);
    } else if (index === 1) {
      opponent1BombPassCountRef.current = count;
      setOpponent1BombPassCount(count);
    } else {
      opponent2BombPassCountRef.current = count;
      setOpponent2BombPassCount(count);
    }
  };

  const addBombForPlayer = (index: PlayerIndex) => {
    if (index === 0) {
      const next = playerBombCountRef.current + 1;
      playerBombCountRef.current = next;
      setPlayerBombCount(next);
    } else if (index === 1) {
      const next = opponent1BombCountRef.current + 1;
      opponent1BombCountRef.current = next;
      setOpponent1BombCount(next);
    } else {
      const next = opponent2BombCountRef.current + 1;
      opponent2BombCountRef.current = next;
      setOpponent2BombCount(next);
    }
  };

  const addShakeForPlayer = (index: PlayerIndex, month: number) => {
    if (index === 0) {
      const nextCount = playerShakeCountRef.current + 1;
      const nextMonths = [...playerShakeMonthsRef.current, month];
      playerShakeCountRef.current = nextCount;
      playerShakeMonthsRef.current = nextMonths;
      setPlayerShakeCount(nextCount);
      setPlayerShakeMonths(nextMonths);
    } else if (index === 1) {
      const nextCount = opponent1ShakeCountRef.current + 1;
      const nextMonths = [...opponent1ShakeMonthsRef.current, month];
      opponent1ShakeCountRef.current = nextCount;
      opponent1ShakeMonthsRef.current = nextMonths;
      setOpponent1ShakeCount(nextCount);
      setOpponent1ShakeMonths(nextMonths);
    } else {
      const nextCount = opponent2ShakeCountRef.current + 1;
      const nextMonths = [...opponent2ShakeMonthsRef.current, month];
      opponent2ShakeCountRef.current = nextCount;
      opponent2ShakeMonthsRef.current = nextMonths;
      setOpponent2ShakeCount(nextCount);
      setOpponent2ShakeMonths(nextMonths);
    }
  };

  /* =========================
     3인 피 뺏기

     쪽/따닥/상대 뻑 회수:
     나머지 두 명에게 각각 1피

     자뻑 회수:
     나머지 두 명에게 각각 2피
  ========================= */

  const stealFromOtherPlayers = (
    winner: PlayerIndex,
    requestedPiPerOpponent: number
  ) => {
    const stolenCards: HwatuCard[] = [];
    let stolenPiValue = 0;

    ([0, 1, 2] as PlayerIndex[]).forEach((loser) => {
      if (loser === winner) return;

      const loserRef = getCapturedRef(loser);
      const result = stealGostopPiCards(
        loserRef.current,
        requestedPiPerOpponent
      );

      setCapturedForPlayer(loser, result.remainingCards);
      stolenCards.push(...result.stolenCards);
      stolenPiValue += result.stolenPiValue;
    });

    return {
      stolenCards,
      stolenPiValue,
    };
  };

  const applyTurnResult = async (
    owner: PlayerIndex,
    result: GostopTurnCompleteResult
  ) => {
    setPendingPlayedVisual(null);

    floorCardsRef.current = result.floorCards;
    setFloorCards(result.floorCards);

    ppeokStacksRef.current = result.ppeokStacks;
    setPpeokStacks(result.ppeokStacks);

    let stolenCards: HwatuCard[] = [];
    let stolenPiValue = 0;

    if (result.stealPi > 0) {
      const stolen = stealFromOtherPlayers(owner, result.stealPi);
      stolenCards = stolen.stolenCards;
      stolenPiValue = stolen.stolenPiValue;
    }

    const movingCards = [
      ...result.capturedCards,
      ...stolenCards,
    ];

    await animateCapturedCards(owner, movingCards);

    const ownerRef = getCapturedRef(owner);
    const nextCaptured = [
      ...ownerRef.current,
      ...result.capturedCards,
      ...stolenCards,
    ];

    setCapturedForPlayer(owner, nextCaptured);

    return stolenPiValue;
  };

  // 폭탄 중간 획득은 applyTurnResult를 사용하고, 완성된 턴만 여기로 옵니다.
  const applyCompletedTurnResult = async (
    owner: PlayerIndex,
    result: GostopTurnCompleteResult
  ) => {
    const hand = owner === 0 ? playerCardsRef.current
      : owner === 1 ? opponent1CardsRef.current : opponent2CardsRef.current;
    const completed = applyGostopPansseul(
      result,
      hand.length + getBombPassCount(owner)
    );
    const stolenPiValue = await applyTurnResult(owner, completed);
    await showSpecialEvents(
      completed.specialEvents,
      completed.stealPi,
      stolenPiValue
    );
  };

  const startGame = () => {
    if (isProcessing) return;

    const dealt = dealGostopCards(hwatuCards);

    playerCardsRef.current = dealt.playerCards;
    opponent1CardsRef.current = dealt.opponent1Cards;
    opponent2CardsRef.current = dealt.opponent2Cards;

    floorCardsRef.current = dealt.floorCards;
    drawPileRef.current = dealt.drawPile;

    playerCapturedCardsRef.current = [];
    opponent1CapturedCardsRef.current = [];
    opponent2CapturedCardsRef.current = [];
    ppeokStacksRef.current = [];

    playerGoCountRef.current = 0;
    opponent1GoCountRef.current = 0;
    opponent2GoCountRef.current = 0;

    lastPlayerGoScoreRef.current = 0;
    lastOpponent1GoScoreRef.current = 0;
    lastOpponent2GoScoreRef.current = 0;

    playerShakeCountRef.current = 0;
    opponent1ShakeCountRef.current = 0;
    opponent2ShakeCountRef.current = 0;
    playerShakeMonthsRef.current = [];
    opponent1ShakeMonthsRef.current = [];
    opponent2ShakeMonthsRef.current = [];
    playerBombCountRef.current = 0;
    opponent1BombCountRef.current = 0;
    opponent2BombCountRef.current = 0;
    playerBombPassCountRef.current = 0;
    opponent1BombPassCountRef.current = 0;
    opponent2BombPassCountRef.current = 0;

    setPlayerCards(dealt.playerCards);
    setOpponent1Cards(dealt.opponent1Cards);
    setOpponent2Cards(dealt.opponent2Cards);

    setFloorCards(dealt.floorCards);
    setDrawPile(dealt.drawPile);

    setPlayerCapturedCards([]);
    setOpponent1CapturedCards([]);
    setOpponent2CapturedCards([]);

    setPpeokStacks([]);
    setExpandedPpeokMonth(null);

    setPendingChoice(null);
    setPendingPlayedVisual(null);
    setFlyingCard(null);
    setCaptureFlight(null);
    setSpecialEffect(null);
    setSpecialActionPrompt(null);
    setCapturedDetailTarget(null);

    setPlayerGoCount(0);
    setOpponent1GoCount(0);
    setOpponent2GoCount(0);

    setLastPlayerGoScore(0);
    setLastOpponent1GoScore(0);
    setLastOpponent2GoScore(0);

    setPlayerShakeCount(0);
    setOpponent1ShakeCount(0);
    setOpponent2ShakeCount(0);
    setPlayerShakeMonths([]);
    setOpponent1ShakeMonths([]);
    setOpponent2ShakeMonths([]);
    setPlayerBombCount(0);
    setOpponent1BombCount(0);
    setOpponent2BombCount(0);
    setPlayerBombPassCount(0);
    setOpponent1BombPassCount(0);
    setOpponent2BombPassCount(0);

    setShowGoStop(false);

    setGameOver(false);
    setGameResult(null);
    setFinalMessage("");
    setSettlement(null);

    setIsProcessing(false);
    setCurrentPlayer(0);
    setTurnMessage("내 차례입니다. 카드를 한 장 선택하세요.");
  };

  useEffect(() => {
    startGame();
    // 최초 진입 시 한 번만 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishGame = (winner: PlayerIndex) => {
    const winnerScore = calculateScore(
      getCapturedRef(winner).current
    ).total;

    const settlementResult = calculateGostopSettlement({
      winner,
      players: [
        {
          index: 0,
          cards: playerCapturedCardsRef.current,
          goCount: playerGoCountRef.current,
          shakeCount: playerShakeCountRef.current,
          bombCount: playerBombCountRef.current,
        },
        {
          index: 1,
          cards: opponent1CapturedCardsRef.current,
          goCount: opponent1GoCountRef.current,
          shakeCount: opponent1ShakeCountRef.current,
          bombCount: opponent1BombCountRef.current,
        },
        {
          index: 2,
          cards: opponent2CapturedCardsRef.current,
          goCount: opponent2GoCountRef.current,
          shakeCount: opponent2ShakeCountRef.current,
          bombCount: opponent2BombCountRef.current,
        },
      ],
    });

    setSettlement(settlementResult);
    setGameOver(true);
    setGameResult(winner);
    setShowGoStop(false);
    setSpecialActionPrompt(null);
    setIsProcessing(false);
    setPendingPlayedVisual(null);

    if (winner === 0) {
      setFinalMessage(`${winnerScore}점에서 STOP을 선언했습니다.`);
    } else {
      setFinalMessage(
        `상대 ${winner}가 ${winnerScore}점에서 STOP을 선언했습니다.`
      );
    }

    setTurnMessage("게임이 종료되었습니다.");
  };

  const finishDraw = () => {
    setGameOver(true);
    setGameResult("draw");
    setShowGoStop(false);
    setSpecialActionPrompt(null);
    setIsProcessing(false);
    setPendingPlayedVisual(null);
    setFinalMessage("모든 패가 소진되었습니다.");
    setSettlement(null);
    setTurnMessage("나가리! 이번 판은 무승부입니다.");
  };

  const moveToNextTurn = async (current: PlayerIndex) => {
    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    await sleep(
      current === 0
        ? GAME_SPEED.resultPause
        : GAME_SPEED.opponentAfterAction
    );

    const next = ((current + 1) % 3) as PlayerIndex;

    setCurrentPlayer(next);
    setIsProcessing(false);

    if (next === 0) {
      if (playerBombPassCountRef.current > 0) {
        setTurnMessage(
          `내 차례입니다. 폭탄 패가 ${playerBombPassCountRef.current}장 남았습니다.`
        );
      } else {
        setTurnMessage("내 차례입니다. 카드를 한 장 선택하세요.");
      }
    } else {
      setTurnMessage(`상대 ${next} 차례입니다.`);
    }
  };

  /* =========================
     GO / STOP
  ========================= */

  const finishPlayerTurn = async () => {
    const score = calculateScore(
      playerCapturedCardsRef.current
    ).total;

    const canDeclare =
      score >= GO_STOP_SCORE &&
      score > lastPlayerGoScoreRef.current;

    if (canDeclare) {
      setIsProcessing(false);
      setShowGoStop(true);
      setTurnMessage(`${score}점입니다. GO 또는 STOP을 선택하세요.`);
      return;
    }

    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    await moveToNextTurn(0);
  };

  const handleGo = async () => {
    if (!showGoStop || gameOver) return;

    const score = calculateScore(
      playerCapturedCardsRef.current
    ).total;

    const nextGoCount = playerGoCountRef.current + 1;

    playerGoCountRef.current = nextGoCount;
    lastPlayerGoScoreRef.current = score;

    setPlayerGoCount(nextGoCount);
    setLastPlayerGoScore(score);
    setShowGoStop(false);

    setTurnMessage(`GO! 현재 ${score}점입니다.`);

    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    await moveToNextTurn(0);
  };

  const handleStop = () => {
    if (!showGoStop || gameOver) return;
    finishGame(0);
  };

  const finishAiTurn = async (aiIndex: 1 | 2) => {
    const capturedCards = getCapturedRef(aiIndex).current;
    const score = calculateScore(capturedCards).total;

    const lastGoScore =
      aiIndex === 1
        ? lastOpponent1GoScoreRef.current
        : lastOpponent2GoScoreRef.current;

    const goCount =
      aiIndex === 1
        ? opponent1GoCountRef.current
        : opponent2GoCountRef.current;

    const canDeclare =
      score >= GO_STOP_SCORE &&
      score > lastGoScore;

    if (canDeclare) {
      const shouldStop =
        isRoundExhausted() ||
        score >= 5 ||
        goCount >= 1;

      if (shouldStop) {
        setTurnMessage(
          `상대 ${aiIndex}가 ${score}점에서 STOP을 선언했습니다.`
        );

        await sleep(GAME_SPEED.opponentStopHold);
        finishGame(aiIndex);
        return;
      }

      const nextGoCount = goCount + 1;

      if (aiIndex === 1) {
        opponent1GoCountRef.current = nextGoCount;
        lastOpponent1GoScoreRef.current = score;
        setOpponent1GoCount(nextGoCount);
        setLastOpponent1GoScore(score);
      } else {
        opponent2GoCountRef.current = nextGoCount;
        lastOpponent2GoScoreRef.current = score;
        setOpponent2GoCount(nextGoCount);
        setLastOpponent2GoScore(score);
      }

      setTurnMessage(`상대 ${aiIndex}가 GO를 선언했습니다!`);
      await sleep(GAME_SPEED.opponentStopHold);
      await moveToNextTurn(aiIndex);
      return;
    }

    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    await moveToNextTurn(aiIndex);
  };

  /* =========================
     임시 겹침 표시
  ========================= */

  const showPreparedFloor = async (
    prepared: GostopPreparedPlay
  ) => {
    floorCardsRef.current = prepared.provisionalFloorCards;
    setFloorCards(prepared.provisionalFloorCards);

    if (
      (prepared.matchCount === 1 || prepared.matchCount === 2) &&
      prepared.matchedCards[0]
    ) {
      setPendingPlayedVisual({
        card: prepared.playedCard,
        targetCardId: prepared.matchedCards[0].id,
        owner: prepared.owner,
      });

      await sleep(GAME_SPEED.stackIn);
    } else {
      setPendingPlayedVisual(null);
    }
  };

  /* =========================
     내 턴 계속
  ========================= */

  const continuePlayerTurn = async (
    prepared: GostopPreparedPlay
  ) => {
    await showPreparedFloor(prepared);

    const currentPile = drawPileRef.current;

    if (currentPile.length === 0) {
      const result = finalizeGostopPreparedPlay(prepared);
      await applyCompletedTurnResult(0, result);

      await finishPlayerTurn();
      return;
    }

    const drawnCard = currentPile[0];
    const remainingPile = currentPile.slice(1);

    drawPileRef.current = remainingPile;
    setDrawPile(remainingPile);

    setTurnMessage("더미에서 카드를 뒤집습니다.");

    await animateFlyingCard(drawnCard, "player-draw", true);

    const drawResult = resolveGostopTurnDraw(
      prepared,
      drawnCard
    );

    if (drawResult.type === "choice") {
      floorCardsRef.current = drawResult.floorCardsBeforeChoice;
      setFloorCards(drawResult.floorCardsBeforeChoice);
      setPendingPlayedVisual(null);

      setPendingChoice({
        type: "draw",
        matchingCards: drawResult.matchingCards,
        choice: drawResult,
      });

      setTurnMessage(
        `더미에서 ${drawnCard.month}월 카드가 나왔습니다. 가져갈 카드를 선택하세요.`
      );
      setIsProcessing(false);
      return;
    }

    await applyCompletedTurnResult(0, drawResult);

    await sleep(GAME_SPEED.resultPause);
    await finishPlayerTurn();
  };

  const drawOnlyForPlayer = async () => {
    const currentPile = drawPileRef.current;

    if (currentPile.length === 0) {
      await finishPlayerTurn();
      return;
    }

    const drawnCard = currentPile[0];
    const remainingPile = currentPile.slice(1);

    drawPileRef.current = remainingPile;
    setDrawPile(remainingPile);
    setTurnMessage("더미에서 카드를 뒤집습니다.");

    await animateFlyingCard(drawnCard, "player-draw", true);

    const drawResult = resolveGostopDrawOnly(
      drawnCard,
      floorCardsRef.current,
      0,
      ppeokStacksRef.current
    );

    if (drawResult.type === "choice") {
      setPendingChoice({
        type: "draw",
        matchingCards: drawResult.matchingCards,
        choice: drawResult,
      });
      setTurnMessage(
        `더미에서 ${drawnCard.month}월 카드가 나왔습니다. 가져갈 카드를 선택하세요.`
      );
      setIsProcessing(false);
      return;
    }

    await applyCompletedTurnResult(0, drawResult);
    await sleep(GAME_SPEED.resultPause);
    await finishPlayerTurn();
  };

  const playSinglePlayerCard = async (card: HwatuCard) => {
    setIsProcessing(true);

    const nextCards = playerCardsRef.current.filter(
      (playerCard) => playerCard.id !== card.id
    );

    playerCardsRef.current = nextCards;
    setPlayerCards(nextCards);

    setTurnMessage(`${card.month}월 카드를 냅니다.`);
    await animateFlyingCard(card, "player-play", false);

    const handResult = prepareGostopHandPlay(
      card,
      floorCardsRef.current,
      0,
      ppeokStacksRef.current
    );

    if (handResult.type === "choice") {
      setPendingChoice({
        type: "hand",
        playedCard: card,
        matchingCards: handResult.matchingCards,
      });

      setTurnMessage("가져갈 바닥패를 선택하세요.");
      setIsProcessing(false);
      return;
    }

    await continuePlayerTurn(handResult.prepared);
  };

  const handlePlayerCard = async (card: HwatuCard) => {
    if (
      currentPlayer !== 0 ||
      isProcessing ||
      pendingChoice ||
      specialActionPrompt ||
      showGoStop ||
      gameOver ||
      playerBombPassCountRef.current > 0
    ) {
      return;
    }

    const bombAction = getGostopBombActionForMonth(
      playerCardsRef.current,
      floorCardsRef.current,
      card.month
    );

    if (bombAction) {
      setSpecialActionPrompt({
        type: "bomb",
        card,
        month: card.month,
      });
      setTurnMessage(
        `${card.month}월 3장과 바닥 1장이 있습니다. 폭탄을 사용할 수 있습니다.`
      );
      return;
    }

    if (
      canGostopShakeMonth(
        playerCardsRef.current,
        floorCardsRef.current,
        card.month
      )
    ) {
      setSpecialActionPrompt({
        type: "shake",
        card,
        month: card.month,
      });
      setTurnMessage(`${card.month}월 세 장을 흔들 수 있습니다.`);
      return;
    }

    await playSinglePlayerCard(card);
  };

  const executePlayerBomb = async (month: number) => {
    const action = getGostopBombActionForMonth(
      playerCardsRef.current,
      floorCardsRef.current,
      month
    );

    setSpecialActionPrompt(null);

    if (!action) {
      setTurnMessage("폭탄 조건이 더 이상 성립하지 않습니다.");
      return;
    }

    setIsProcessing(true);

    const bombIds = new Set(action.handCards.map((card) => card.id));
    const nextHand = playerCardsRef.current.filter(
      (card) => !bombIds.has(card.id)
    );
    const nextFloor = floorCardsRef.current.filter(
      (card) => card.id !== action.floorCard.id
    );

    playerCardsRef.current = nextHand;
    setPlayerCards(nextHand);

    addBombForPlayer(0);
    setBombPassCountForPlayer(
      0,
      playerBombPassCountRef.current + 2
    );

    setTurnMessage("폭탄을 사용합니다!");

    for (const bombCard of action.handCards) {
      await animateFlyingCard(bombCard, "player-play", false);
    }

    const bombResult: GostopTurnCompleteResult = {
      type: "complete",
      floorCards: nextFloor,
      capturedCards: [...action.handCards, action.floorCard],
      stealPi: 1,
      specialEvents: ["bomb"],
      ppeokStacks: ppeokStacksRef.current,
    };

    const stolenPiValue = await applyTurnResult(0, bombResult);
    await showSpecialEvents(["bomb"], 1, stolenPiValue);
    await sleep(GAME_SPEED.bombPause);
    await drawOnlyForPlayer();
  };

  const handleSpecialActionConfirm = async () => {
    if (!specialActionPrompt || gameOver || isProcessing) return;

    const prompt = specialActionPrompt;

    if (prompt.type === "bomb") {
      await executePlayerBomb(prompt.month);
      return;
    }

    setSpecialActionPrompt(null);
    setIsProcessing(true);
    addShakeForPlayer(0, prompt.month);
    await showShakeReveal(0, prompt.month);
    await playSinglePlayerCard(prompt.card);
  };

  const handleSpecialActionNormal = async () => {
    if (!specialActionPrompt || gameOver || isProcessing) return;

    const card = specialActionPrompt.card;
    setSpecialActionPrompt(null);
    await playSinglePlayerCard(card);
  };

  const handleBombPass = async () => {
    if (
      currentPlayer !== 0 ||
      gameOver ||
      showGoStop ||
      pendingChoice ||
      specialActionPrompt ||
      isProcessing ||
      playerBombPassCountRef.current <= 0
    ) {
      return;
    }

    setIsProcessing(true);
    setBombPassCountForPlayer(0, playerBombPassCountRef.current - 1);
    await showSpecialEvents(["bomb-pass"], 0, 0);
    await drawOnlyForPlayer();
  };

  const handleFloorChoice = async (selectedCard: HwatuCard) => {
    if (!pendingChoice || isProcessing || gameOver) return;

    const allowed = pendingChoice.matchingCards.some(
      (card) => card.id === selectedCard.id
    );

    if (!allowed) return;

    setIsProcessing(true);

    if (pendingChoice.type === "hand") {
      const playedCard = pendingChoice.playedCard;
      setPendingChoice(null);

      const handResult = prepareGostopHandPlay(
        playedCard,
        floorCardsRef.current,
        0,
        ppeokStacksRef.current,
        selectedCard.id
      );

      if (handResult.type === "choice") {
        setIsProcessing(false);
        return;
      }

      await continuePlayerTurn(handResult.prepared);
      return;
    }

    const result = resolveGostopDrawChoice(
      pendingChoice.choice,
      selectedCard
    );

    setPendingChoice(null);

    await applyCompletedTurnResult(0, result);

    await sleep(GAME_SPEED.resultPause);
    await finishPlayerTurn();
  };

  /* =========================
     AI 턴
  ========================= */

  const runAiTurn = async (aiIndex: 1 | 2) => {
    if (gameOver) return;

    setIsProcessing(true);
    setTurnMessage(`상대 ${aiIndex}가 카드를 고르는 중...`);
    await sleep(GAME_SPEED.opponentThink);

    const handRef =
      aiIndex === 1 ? opponent1CardsRef : opponent2CardsRef;

    const setAiHand = (cards: HwatuCard[]) => {
      handRef.current = cards;
      if (aiIndex === 1) {
        setOpponent1Cards(cards);
      } else {
        setOpponent2Cards(cards);
      }
    };

    const doAiDrawOnly = async () => {
      const currentPile = drawPileRef.current;

      if (currentPile.length === 0) {
        await finishAiTurn(aiIndex);
        return;
      }

      const drawnCard = currentPile[0];
      const remainingPile = currentPile.slice(1);

      drawPileRef.current = remainingPile;
      setDrawPile(remainingPile);

      setTurnMessage(`상대 ${aiIndex}가 더미에서 카드를 뒤집습니다.`);
      await animateFlyingCard(drawnCard, "opponent-draw", true);

      const drawResult = resolveGostopDrawOnly(
        drawnCard,
        floorCardsRef.current,
        aiIndex,
        ppeokStacksRef.current
      );

      let completeResult: GostopTurnCompleteResult;

      if (drawResult.type === "choice") {
        const selected =
          drawResult.matchingCards[
            Math.floor(Math.random() * drawResult.matchingCards.length)
          ];
        completeResult = resolveGostopDrawChoice(drawResult, selected);
      } else {
        completeResult = drawResult;
      }

      await applyCompletedTurnResult(aiIndex, completeResult);
      await finishAiTurn(aiIndex);
    };

    if (getBombPassCount(aiIndex) > 0) {
      setBombPassCountForPlayer(aiIndex, getBombPassCount(aiIndex) - 1);
      await showSpecialEvents(["bomb-pass"], 0, 0);
      await doAiDrawOnly();
      return;
    }

    const currentHand = handRef.current;

    if (currentHand.length === 0) {
      await finishAiTurn(aiIndex);
      return;
    }

    const bombAction = findGostopBombAction(
      currentHand,
      floorCardsRef.current
    );

    if (bombAction) {
      const bombIds = new Set(bombAction.handCards.map((card) => card.id));
      const nextHand = currentHand.filter((card) => !bombIds.has(card.id));
      const nextFloor = floorCardsRef.current.filter(
        (card) => card.id !== bombAction.floorCard.id
      );

      setAiHand(nextHand);
      addBombForPlayer(aiIndex);
      setBombPassCountForPlayer(aiIndex, getBombPassCount(aiIndex) + 2);

      setTurnMessage(`상대 ${aiIndex}가 폭탄을 사용합니다!`);

      for (const bombCard of bombAction.handCards) {
        await animateFlyingCard(bombCard, "opponent-play", true);
      }

      const bombResult: GostopTurnCompleteResult = {
        type: "complete",
        floorCards: nextFloor,
        capturedCards: [...bombAction.handCards, bombAction.floorCard],
        stealPi: 1,
        specialEvents: ["bomb"],
        ppeokStacks: ppeokStacksRef.current,
      };

      const stolenPiValue = await applyTurnResult(aiIndex, bombResult);
      await showSpecialEvents(["bomb"], 1, stolenPiValue);
      await sleep(GAME_SPEED.bombPause);
      await doAiDrawOnly();
      return;
    }

    const shakeMonth = findGostopShakeMonth(
      currentHand,
      floorCardsRef.current
    );

    let playedCard: HwatuCard;

    if (shakeMonth !== null) {
      const shakeCards = currentHand.filter(
        (card) => card.month === shakeMonth
      );
      playedCard =
        shakeCards[Math.floor(Math.random() * shakeCards.length)];

      addShakeForPlayer(aiIndex, shakeMonth);
      await showShakeReveal(aiIndex, shakeMonth);
    } else {
      playedCard =
        currentHand[Math.floor(Math.random() * currentHand.length)];
    }

    const nextHand = currentHand.filter(
      (card) => card.id !== playedCard.id
    );
    setAiHand(nextHand);

    setTurnMessage(`상대 ${aiIndex}가 카드를 냅니다.`);
    await animateFlyingCard(playedCard, "opponent-play", true);

    let handResult = prepareGostopHandPlay(
      playedCard,
      floorCardsRef.current,
      aiIndex,
      ppeokStacksRef.current
    );

    if (handResult.type === "choice") {
      const selected =
        handResult.matchingCards[
          Math.floor(Math.random() * handResult.matchingCards.length)
        ];

      handResult = prepareGostopHandPlay(
        playedCard,
        floorCardsRef.current,
        aiIndex,
        ppeokStacksRef.current,
        selected.id
      );
    }

    if (handResult.type !== "ready") {
      setIsProcessing(false);
      return;
    }

    const prepared = handResult.prepared;
    await showPreparedFloor(prepared);

    const currentPile = drawPileRef.current;
    let completeResult: GostopTurnCompleteResult;

    if (currentPile.length === 0) {
      completeResult = finalizeGostopPreparedPlay(prepared);
    } else {
      const drawnCard = currentPile[0];
      const remainingPile = currentPile.slice(1);

      drawPileRef.current = remainingPile;
      setDrawPile(remainingPile);

      setTurnMessage(`상대 ${aiIndex}가 더미에서 카드를 뒤집습니다.`);
      await animateFlyingCard(drawnCard, "opponent-draw", true);

      const drawResult = resolveGostopTurnDraw(prepared, drawnCard);

      if (drawResult.type === "choice") {
        const selected =
          drawResult.matchingCards[
            Math.floor(Math.random() * drawResult.matchingCards.length)
          ];
        completeResult = resolveGostopDrawChoice(drawResult, selected);
      } else {
        completeResult = drawResult;
      }
    }

    await applyCompletedTurnResult(aiIndex, completeResult);

    await sleep(GAME_SPEED.opponentAfterAction);
    await finishAiTurn(aiIndex);
  };

  useEffect(() => {
    if (
      currentPlayer === 0 ||
      isProcessing ||
      pendingChoice ||
      specialActionPrompt ||
      showGoStop ||
      gameOver
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runAiTurn(currentPlayer);
    }, GAME_SPEED.opponentTurnDelay);

    return () => {
      window.clearTimeout(timer);
    };
    // 상태 전환을 기준으로 AI를 한 번만 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPlayer,
    isProcessing,
    pendingChoice,
    specialActionPrompt,
    showGoStop,
    gameOver,
  ]);

  useEffect(() => {
    if (
      expandedPpeokMonth !== null &&
      !ppeokStacks.some(
        (stack) => stack.month === expandedPpeokMonth
      )
    ) {
      setExpandedPpeokMonth(null);
    }
  }, [expandedPpeokMonth, ppeokStacks]);

  /* =========================
     바닥 표시용 데이터
  ========================= */

  const floorDisplayItems: FloorDisplayItem[] = [];
  const renderedPpeokMonths = new Set<number>();

  floorCards.forEach((card) => {
    const ppeokStack = ppeokStacks.find(
      (stack) => stack.month === card.month
    );

    if (ppeokStack) {
      if (renderedPpeokMonths.has(card.month)) return;

      renderedPpeokMonths.add(card.month);

      floorDisplayItems.push({
        type: "ppeok",
        month: card.month,
        cards: floorCards.filter(
          (floorCard) => floorCard.month === card.month
        ),
        owner: ppeokStack.owner,
      });

      return;
    }

    floorDisplayItems.push({
      type: "card",
      card,
    });
  });

  const playerScore = calculateScore(playerCapturedCards);
  const opponent1Score = calculateScore(opponent1CapturedCards);
  const opponent2Score = calculateScore(opponent2CapturedCards);

  const detailCards =
    capturedDetailTarget === 0
      ? playerCapturedCards
      : capturedDetailTarget === 1
        ? opponent1CapturedCards
        : capturedDetailTarget === 2
          ? opponent2CapturedCards
          : [];

  const detailTitle =
    capturedDetailTarget === 0
      ? "내 먹은 패"
      : capturedDetailTarget === 1
        ? "상대 1 먹은 패"
        : "상대 2 먹은 패";

  const detailGoCount =
    capturedDetailTarget === 0
      ? playerGoCount
      : capturedDetailTarget === 1
        ? opponent1GoCount
        : opponent2GoCount;

  const detailShakeMonths =
    capturedDetailTarget === 0
      ? playerShakeMonths
      : capturedDetailTarget === 1
        ? opponent1ShakeMonths
        : opponent2ShakeMonths;

  const detailBombCount =
    capturedDetailTarget === 0
      ? playerBombCount
      : capturedDetailTarget === 1
        ? opponent1BombCount
        : opponent2BombCount;

  return (
    <main
      className={`game gostop3-game ${
        isProcessing ? "is-animating" : ""
      }`}
      style={GAME_SPEED_STYLE}
    >
      {specialEffect && (
        <div className="special-effect">{specialEffect}</div>
      )}

      {capturedDetailTarget !== null && (
        <CapturedCardsModal
          title={detailTitle}
          cards={detailCards}
          goCount={detailGoCount}
          shakeMonths={detailShakeMonths}
          bombCount={detailBombCount}
          onClose={() => setCapturedDetailTarget(null)}
        />
      )}

      {specialActionPrompt && !gameOver && (
        <div className="special-action-overlay">
          <div className="special-action-modal">
            <span className="special-action-label">
              {specialActionPrompt.month}월 특수 행동
            </span>

            <h2>
              {specialActionPrompt.type === "bomb"
                ? "폭탄 가능!"
                : "흔들기 가능!"}
            </h2>

            <p>
              {specialActionPrompt.type === "bomb"
                ? "같은 월 카드 3장과 바닥의 같은 월 1장을 한꺼번에 먹습니다. 이후 폭탄 패 2회가 생깁니다."
                : `손에 있는 ${specialActionPrompt.month}월 카드 3장을 공개하고 한 장을 냅니다.`}
            </p>

            <div className="special-action-buttons">
              <button
                type="button"
                className="special-action-confirm"
                onClick={() => void handleSpecialActionConfirm()}
              >
                {specialActionPrompt.type === "bomb" ? "폭탄 사용" : "흔들기"}
              </button>

              <button
                type="button"
                className="special-action-normal"
                onClick={() => void handleSpecialActionNormal()}
              >
                그냥 한 장 내기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 확정된 먹은 패 이동 */}
      {captureFlight && captureFlight.cards.length > 0 && (
        <div className="capture-flight-layer" aria-hidden="true">
          <div
            className={`capture-flight gostop3-capture-flight gostop3-capture-flight--${captureFlight.owner}`}
          >
            {captureFlight.cards.slice(0, 4).map((card, index) => (
              <div
                key={card.id}
                className="capture-flight-card"
                style={{
                  transform: `translate(${index * 7}px, ${index * 4}px)`,
                }}
              >
                <Card card={card} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 손패 / 더미 카드 이동 */}
      {flyingCard && (
        <div className="animation-layer" aria-hidden="true">
          <div className={`flying-card flying-card--${flyingCard.kind}`}>
            {flyingCard.startsFaceDown ? (
              <div
                className={`flip-card ${
                  flyingCard.faceUp ? "is-flipped" : ""
                }`}
              >
                <div className="flip-card-inner">
                  <div className="flying-face flying-face--back">
                    <Card isBack />
                  </div>

                  <div className="flying-face flying-face--front">
                    <Card card={flyingCard.card} />
                  </div>
                </div>
              </div>
            ) : (
              <Card card={flyingCard.card} />
            )}
          </div>
        </div>
      )}

      {/* GO / STOP */}
      {showGoStop && !gameOver && (
        <div className="go-stop-overlay">
          <div className="go-stop-modal">
            <span className="go-stop-small">현재 점수</span>
            <strong className="go-stop-score">{playerScore.total}점</strong>

            <p>
              3인 고스톱은 {GO_STOP_SCORE}점부터 선언할 수 있습니다.
              <br />
              GO를 선언하고 계속하시겠습니까?
            </p>

            <div className="go-stop-buttons">
              <button type="button" className="go-button" onClick={handleGo}>
                GO
              </button>

              <button
                type="button"
                className="stop-button"
                onClick={handleStop}
              >
                STOP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 게임 종료 */}
      {gameOver && (
        <div className="game-over-overlay">
          <div
            className={`game-over-modal ${
              gameResult === "draw" ? "game-over-modal--draw" : ""
            }`}
          >
            <span className="game-over-label">
              {gameResult === "draw" ? "ROUND OVER" : "GAME OVER"}
            </span>

            <h2>
              {gameResult === 0 && "승리!"}
              {(gameResult === 1 || gameResult === 2) && "패배"}
              {gameResult === "draw" && "나가리"}
            </h2>

            <p>{finalMessage}</p>

            <div className="gostop3-final-scores">
              <div>
                <span>나</span>
                <strong>{playerScore.total}점</strong>
                <small>{playerGoCount} GO</small>
              </div>

              <div>
                <span>상대 1</span>
                <strong>{opponent1Score.total}점</strong>
                <small>{opponent1GoCount} GO</small>
              </div>

              <div>
                <span>상대 2</span>
                <strong>{opponent2Score.total}점</strong>
                <small>{opponent2GoCount} GO</small>
              </div>
            </div>

            {settlement && gameResult !== "draw" && (
              <div className="gostop3-settlement-panel">
                <div className="gostop3-settlement-heading">
                  <div>
                    <span>최종 정산</span>
                    <strong>
                      {settlement.scoreBeforeMultipliers}점 기준
                    </strong>
                  </div>

                  <div className="gostop3-settlement-total">
                    <span>총 획득</span>
                    <strong>{settlement.totalReceived}점</strong>
                  </div>
                </div>

                <div className="gostop3-settlement-formula">
                  <span>기본 {settlement.baseScore}점</span>
                  {settlement.goBonus > 0 && (
                    <span>GO 보너스 +{settlement.goBonus}</span>
                  )}

                  {settlement.winnerMultipliers.map((item) => (
                    <span key={item.id}>
                      {item.label} ×{item.multiplier}
                    </span>
                  ))}
                </div>

                <div className="gostop3-settlement-losers">
                  {settlement.loserSettlements.map((loser) => (
                    <div
                      key={loser.loser}
                      className={`gostop3-settlement-loser ${
                        loser.goBak ? "is-go-bak" : ""
                      }`}
                    >
                      <div className="gostop3-settlement-loser-name">
                        <strong>{getPlayerName(loser.loser)}</strong>
                        <span>
                          {loser.payment === 0
                            ? "고박 대납"
                            : `${loser.payment}점 지불`}
                        </span>
                      </div>

                      <div className="gostop3-settlement-tags">
                        {loser.gwangBak && <span>광박 ×2</span>}
                        {loser.piBak && <span>피박 ×2</span>}
                        {loser.goBak && <span>고박</span>}

                        {!loser.gwangBak &&
                          !loser.piBak &&
                          !loser.goBak && <span>추가 박 없음</span>}
                      </div>

                      {loser.goBakPaidFor !== null && (
                        <small>
                          {getPlayerName(loser.goBakPaidFor)}의 정산까지
                          대신 부담합니다.
                        </small>
                      )}
                    </div>
                  ))}
                </div>

                {settlement.goBakPayer !== null && (
                  <p className="gostop3-settlement-note">
                    {getPlayerName(settlement.goBakPayer)} 고박: 다른
                    패자의 정산까지 대신 부담했습니다.
                  </p>
                )}
              </div>
            )}

            {gameResult !== null && gameResult !== "draw" && (
              <div className="nagari-message">
                승자: {getPlayerName(gameResult)}
              </div>
            )}

            {gameResult === "draw" && (
              <div className="nagari-message">
                이번 판은 무승부입니다.
              </div>
            )}

            <button
              type="button"
              className="restart-game-button"
              onClick={startGame}
            >
              다시 시작
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="gostop3-restart-button"
        onClick={startGame}
        disabled={isProcessing || showGoStop || Boolean(specialActionPrompt)}
      >
        다시 시작
      </button>

      <div className="turn-message">{turnMessage}</div>

      {/* 먹은 패 패널 */}
      <CapturedPanel
        title="상대 1 먹은 패"
        cards={opponent1CapturedCards}
        score={opponent1Score}
        position="opponent1"
        goCount={opponent1GoCount}
        shakeCount={opponent1ShakeCount}
        shakeMonths={opponent1ShakeMonths}
        bombCount={opponent1BombCount}
        onOpenDetails={() => setCapturedDetailTarget(1)}
      />

      <CapturedPanel
        title="상대 2 먹은 패"
        cards={opponent2CapturedCards}
        score={opponent2Score}
        position="opponent2"
        goCount={opponent2GoCount}
        shakeCount={opponent2ShakeCount}
        shakeMonths={opponent2ShakeMonths}
        bombCount={opponent2BombCount}
        onOpenDetails={() => setCapturedDetailTarget(2)}
      />

      <CapturedPanel
        title="내 먹은 패"
        cards={playerCapturedCards}
        score={playerScore}
        position="player"
        goCount={playerGoCount}
        shakeCount={playerShakeCount}
        shakeMonths={playerShakeMonths}
        bombCount={playerBombCount}
        onOpenDetails={() => setCapturedDetailTarget(0)}
      />

      {/* 상대 1 / 상대 2 */}
      <section className="gostop3-opponents-area">
        <div className="gostop3-opponent-zone">
          <h2>
            상대 1
            {currentPlayer === 1 && !gameOver && " ◀"}
          </h2>

          <div className="card-row gostop3-opponent-hand">
            {opponent1Cards.map((card) => (
              <Card key={card.id} isBack />
            ))}
          </div>

          <p>
            손패 {opponent1Cards.length}장 · 점수 {opponent1Score.total}점 · GO{" "}
            {opponent1GoCount}회 · 폭탄 {opponent1BombCount} · 흔들기 {opponent1ShakeCount}
          </p>
        </div>

        <div className="gostop3-opponent-zone">
          <h2>
            상대 2
            {currentPlayer === 2 && !gameOver && " ◀"}
          </h2>

          <div className="card-row gostop3-opponent-hand">
            {opponent2Cards.map((card) => (
              <Card key={card.id} isBack />
            ))}
          </div>

          <p>
            손패 {opponent2Cards.length}장 · 점수 {opponent2Score.total}점 · GO{" "}
            {opponent2GoCount}회 · 폭탄 {opponent2BombCount} · 흔들기 {opponent2ShakeCount}
          </p>
        </div>
      </section>

      {/* 중앙 바닥 */}
      <section className="table gostop3-table">
        <h2>
          바닥패
          {ppeokStacks.length > 0 && (
            <span className="ppeok-count">뻑 {ppeokStacks.length}</span>
          )}
        </h2>

        {pendingChoice && (
          <div className="choice-message">
            같은 월 카드가 2장입니다.
            <br />
            가져갈 카드를 선택하세요.
          </div>
        )}

        <div className="table-content">
          <div className="floor-cards">
            {floorDisplayItems.map((item) => {
              if (item.type === "ppeok") {
                const isExpanded = expandedPpeokMonth === item.month;

                return (
                  <div
                    key={`ppeok-${item.month}`}
                    className={`ppeok-stack-slot ${
                      isExpanded ? "is-open" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={`${item.month}월 뻑 ${item.cards.length}장. ${getPlayerName(
                      item.owner
                    )}가 만든 뻑입니다.`}
                    onClick={() =>
                      setExpandedPpeokMonth((current) =>
                        current === item.month ? null : item.month
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedPpeokMonth((current) =>
                          current === item.month ? null : item.month
                        );
                      }
                    }}
                  >
                    <div className="ppeok-stack-cards">
                      {item.cards.slice(0, 3).map((stackCard, index) => (
                        <div
                          key={stackCard.id}
                          className="ppeok-stack-card"
                          style={{
                            "--ppeok-index": index,
                          } as CSSProperties}
                        >
                          <Card card={stackCard} />
                        </div>
                      ))}
                    </div>

                    <div className="ppeok-stack-label">
                      <strong>{item.month}월 뻑</strong>
                      <span>
                        {item.cards.length}장 · {getPlayerName(item.owner)} 뻑
                      </span>
                    </div>

                    <div className="ppeok-stack-detail">
                      <div className="ppeok-stack-detail-header">
                        <strong>{item.month}월 뻑</strong>
                        <span>카드 {item.cards.length}장</span>
                      </div>

                      <div className="ppeok-stack-detail-cards">
                        {item.cards.map((stackCard) => (
                          <div key={stackCard.id} className="ppeok-detail-card">
                            <Card card={stackCard} />
                          </div>
                        ))}
                      </div>

                      <div className="ppeok-stack-detail-note">
                        {getPlayerName(item.owner)}가 만든 뻑입니다.
                        <br />
                        클릭하면 상세 패를 고정해서 볼 수 있습니다.
                      </div>
                    </div>
                  </div>
                );
              }

              const card = item.card;

              const isSelectable =
                pendingChoice?.matchingCards.some(
                  (matchingCard) => matchingCard.id === card.id
                ) ?? false;

              const hasPlayedOverlay =
                pendingPlayedVisual?.targetCardId === card.id;

              return (
                <div key={card.id} className="floor-card-slot">
                  <Card
                    card={card}
                    isSelectable={isSelectable}
                    onClick={
                      isSelectable && !isProcessing && !gameOver
                        ? () => void handleFloorChoice(card)
                        : undefined
                    }
                  />

                  {hasPlayedOverlay && pendingPlayedVisual && (
                    <div
                      className={`played-card-overlay gostop3-played-card-overlay--${pendingPlayedVisual.owner}`}
                    >
                      <Card card={pendingPlayedVisual.card} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="draw-pile-area">
            {drawPile.length > 0 && <Card isBack />}
            <span>더미 {drawPile.length}장</span>
          </div>
        </div>
      </section>

      {/* 내 패 */}
      <section className="player-area gostop3-player-area">
        <h2>
          내 패
          {currentPlayer === 0 && !gameOver && " ◀"}
        </h2>

        {currentPlayer === 0 && playerBombPassCount > 0 && !gameOver && (
          <button
            type="button"
            className="bomb-pass-button"
            onClick={() => void handleBombPass()}
            disabled={isProcessing || showGoStop || Boolean(specialActionPrompt)}
          >
            폭탄 패 사용 · 남은 {playerBombPassCount}회
          </button>
        )}

        <div className="card-row gostop3-player-hand">
          {playerCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              onClick={
                currentPlayer === 0 &&
                !pendingChoice &&
                !specialActionPrompt &&
                playerBombPassCount === 0 &&
                !isProcessing &&
                !showGoStop &&
                !gameOver
                  ? () => void handlePlayerCard(card)
                  : undefined
              }
            />
          ))}
        </div>

        <p>
          손패 {playerCards.length}장 · 점수 {playerScore.total}점 · GO{" "}
          {playerGoCount}회 · 폭탄 {playerBombCount} · 흔들기 {playerShakeCount}
        </p>
      </section>
    </main>
  );
}

export default GostopGame;
