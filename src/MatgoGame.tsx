import CapturedPanel from "./components/CapturedPanel";
import MatgoTable from "./components/MatgoTable";
import { GAME_SPEED, GAME_SPEED_STYLE } from "./components/matgoSpeed";
import { getSpecialEventName } from "./components/matgoEvents";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";

import Card from "./components/Card";
import CapturedCardsModal from "./components/CapturedCardsModal";
import { hwatuCards } from "./data/cards";
import { dealCards } from "./game/deal";
import { calculateScore } from "./game/scoring";
import {
  calculateSettlement,
  type SettlementResult,
} from "./game/settlement";
import {
  applyPansseul,
  canShakeMonth,
  findBombAction,
  findShakeMonth,
  finalizePreparedPlay,
  getBombActionForMonth,
  prepareHandPlay,
  resolveDrawChoice,
  resolveDrawOnly,
  resolveTurnDraw,
  stealPiCards,
  type DrawChoiceState,
  type PpeokStack,
  type PreparedPlay,
  type SpecialEvent,
  type TurnCompleteResult,
} from "./game/turn";
import type { HwatuCard } from "./types/game";

type Turn = "player" | "opponent";

type GameResult = "player" | "opponent" | "draw" | null;

type PendingChoice =
  | {
      type: "hand";
      playedCard: HwatuCard;
      matchingCards: HwatuCard[];
    }
  | {
      type: "draw";
      matchingCards: HwatuCard[];
      choice: DrawChoiceState;
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
  owner: Turn;
};

type CaptureFlightState = {
  cards: HwatuCard[];
  side: Turn;
};

const GO_STOP_SCORE = 7;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function MatgoGame() {
  const [myCards, setMyCards] = useState<HwatuCard[]>([]);
  const [opponentCards, setOpponentCards] = useState<HwatuCard[]>([]);
  const [floorCards, setFloorCards] = useState<HwatuCard[]>([]);
  const [drawPile, setDrawPile] = useState<HwatuCard[]>([]);

  const [myCapturedCards, setMyCapturedCards] = useState<HwatuCard[]>([]);
  const [opponentCapturedCards, setOpponentCapturedCards] =
    useState<HwatuCard[]>([]);

  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(
    null
  );
  const [specialActionPrompt, setSpecialActionPrompt] =
    useState<SpecialActionPrompt | null>(null);

  const [gameStarted, setGameStarted] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<Turn>("player");
  const [turnMessage, setTurnMessage] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [flyingCard, setFlyingCard] = useState<FlyingCardState | null>(null);
  const [pendingPlayedVisual, setPendingPlayedVisual] =
    useState<PendingPlayedVisual | null>(null);
  const [captureFlight, setCaptureFlight] =
    useState<CaptureFlightState | null>(null);
  const [capturedDetailTarget, setCapturedDetailTarget] =
    useState<Turn | null>(null);

  const [ppeokStacks, setPpeokStacks] = useState<PpeokStack[]>([]);
  const [expandedPpeokMonth, setExpandedPpeokMonth] = useState<number | null>(null);
  const [specialEffect, setSpecialEffect] = useState<string | null>(null);

  const [showGoStop, setShowGoStop] = useState(false);
  const [playerGoCount, setPlayerGoCount] = useState(0);
  const [opponentGoCount, setOpponentGoCount] = useState(0);
  const [lastPlayerGoScore, setLastPlayerGoScore] = useState(0);

  const [playerShakeCount, setPlayerShakeCount] = useState(0);
  const [opponentShakeCount, setOpponentShakeCount] = useState(0);
  const [playerShakeMonths, setPlayerShakeMonths] = useState<number[]>([]);
  const [opponentShakeMonths, setOpponentShakeMonths] = useState<number[]>([]);
  const [playerBombCount, setPlayerBombCount] = useState(0);
  const [opponentBombCount, setOpponentBombCount] = useState(0);
  const [playerBombPassCount, setPlayerBombPassCount] = useState(0);
  const [opponentBombPassCount, setOpponentBombPassCount] = useState(0);

  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult>(null);
  const [finalMessage, setFinalMessage] = useState("");
  const [settlementResult, setSettlementResult] =
    useState<SettlementResult | null>(null);

  const myCardsRef = useRef(myCards);
  const opponentCardsRef = useRef(opponentCards);
  const floorCardsRef = useRef(floorCards);
  const drawPileRef = useRef(drawPile);
  const myCapturedCardsRef = useRef(myCapturedCards);
  const opponentCapturedCardsRef = useRef(opponentCapturedCards);
  const ppeokStacksRef = useRef(ppeokStacks);

  const playerGoCountRef = useRef(playerGoCount);
  const opponentGoCountRef = useRef(opponentGoCount);
  const playerShakeCountRef = useRef(playerShakeCount);
  const opponentShakeCountRef = useRef(opponentShakeCount);
  const playerShakeMonthsRef = useRef(playerShakeMonths);
  const opponentShakeMonthsRef = useRef(opponentShakeMonths);
  const playerBombCountRef = useRef(playerBombCount);
  const opponentBombCountRef = useRef(opponentBombCount);
  const playerBombPassCountRef = useRef(playerBombPassCount);
  const opponentBombPassCountRef = useRef(opponentBombPassCount);

  myCardsRef.current = myCards;
  opponentCardsRef.current = opponentCards;
  floorCardsRef.current = floorCards;
  drawPileRef.current = drawPile;
  myCapturedCardsRef.current = myCapturedCards;
  opponentCapturedCardsRef.current = opponentCapturedCards;
  ppeokStacksRef.current = ppeokStacks;

  playerGoCountRef.current = playerGoCount;
  opponentGoCountRef.current = opponentGoCount;
  playerShakeCountRef.current = playerShakeCount;
  opponentShakeCountRef.current = opponentShakeCount;
  playerShakeMonthsRef.current = playerShakeMonths;
  opponentShakeMonthsRef.current = opponentShakeMonths;
  playerBombCountRef.current = playerBombCount;
  opponentBombCountRef.current = opponentBombCount;
  playerBombPassCountRef.current = playerBombPassCount;
  opponentBombPassCountRef.current = opponentBombPassCount;

  const isRoundExhausted = () =>
    myCardsRef.current.length === 0 &&
    opponentCardsRef.current.length === 0 &&
    drawPileRef.current.length === 0;

  const animateFlyingCard = useCallback(
    async (
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

      // 카드가 가운데까지 이동한 뒤 앞면을 공개합니다.
      await sleep(moveDuration);

      setFlyingCard((prev) =>
        prev
          ? {
              ...prev,
              faceUp: true,
            }
          : null
      );

      // 무엇을 냈고 무엇을 뽑았는지 확인할 시간을 줍니다.
      await sleep(GAME_SPEED.revealHold);
      setFlyingCard(null);
    },
    []
  );

  const animateCapturedCards = useCallback(
    async (side: Turn, cards: HwatuCard[]) => {
      if (cards.length === 0) return;

      setCaptureFlight({ side, cards });
      await sleep(GAME_SPEED.captureMove);
      setCaptureFlight(null);
    },
    []
  );

  const showShakeReveal = useCallback(
    async (side: Turn, month: number) => {
      const subject = side === "player" ? "흔들기!" : "상대방 흔들기!";

      setSpecialEffect(`${subject} ${month}월 ×3 공개`);
      setTurnMessage(`${subject} ${month}월 카드 3장을 공개했습니다.`);

      await sleep(GAME_SPEED.shakeReveal);
      setSpecialEffect(null);
    },
    []
  );

  const showSpecialEvents = useCallback(
    async (
      events: SpecialEvent[],
      requestedPi = 0,
      stolenCards = 0
    ) => {
      if (events.length === 0) return;

      const names = events
        .map(getSpecialEventName)
        .filter(Boolean)
        .join(" + ");

      let detail = "";

      if (requestedPi > 0 && stolenCards > 0) {
        detail = ` · 상대 피 ${stolenCards}장 획득`;
      } else if (requestedPi > 0 && stolenCards === 0) {
        detail = " · 상대에게 가져올 피가 없습니다.";
      }

      setSpecialEffect(names);
      setTurnMessage(`${names}${detail}`);

      await sleep(GAME_SPEED.specialEffect);
      setSpecialEffect(null);
    },
    []
  );

  const applyTurnResult = useCallback(
    async (side: Turn, result: TurnCompleteResult) => {
      setPendingPlayedVisual(null);

      floorCardsRef.current = result.floorCards;
      setFloorCards(result.floorCards);

      ppeokStacksRef.current = result.ppeokStacks;
      setPpeokStacks(result.ppeokStacks);

      let stolenCount = 0;
      let stolenCards: HwatuCard[] = [];

      if (side === "player" && result.stealPi > 0) {
        const stolen = stealPiCards(
          opponentCapturedCardsRef.current,
          result.stealPi
        );

        stolenCards = stolen.stolenCards;
        stolenCount = stolen.stolenCards.length;

        opponentCapturedCardsRef.current = stolen.remainingCards;
        setOpponentCapturedCards(stolen.remainingCards);
      }

      if (side === "opponent" && result.stealPi > 0) {
        const stolen = stealPiCards(
          myCapturedCardsRef.current,
          result.stealPi
        );

        stolenCards = stolen.stolenCards;
        stolenCount = stolen.stolenCards.length;

        myCapturedCardsRef.current = stolen.remainingCards;
        setMyCapturedCards(stolen.remainingCards);
      }

      const cardsMovingToCapture = [
        ...result.capturedCards,
        ...stolenCards,
      ];

      await animateCapturedCards(side, cardsMovingToCapture);

      if (side === "player") {
        const nextMyCards = [
          ...myCapturedCardsRef.current,
          ...result.capturedCards,
          ...stolenCards,
        ];

        myCapturedCardsRef.current = nextMyCards;
        setMyCapturedCards(nextMyCards);
      } else {
        const nextOpponentCards = [
          ...opponentCapturedCardsRef.current,
          ...result.capturedCards,
          ...stolenCards,
        ];

        opponentCapturedCardsRef.current = nextOpponentCards;
        setOpponentCapturedCards(nextOpponentCards);
      }

      return stolenCount;
    },
    [animateCapturedCards]
  );

  // 폭탄 중간 획득은 applyTurnResult를 사용하고, 완성된 턴만 여기로 옵니다.
  const applyCompletedTurnResult = useCallback(
    async (side: Turn, result: TurnCompleteResult) => {
      const remainingActions = side === "player"
        ? myCardsRef.current.length + playerBombPassCountRef.current
        : opponentCardsRef.current.length + opponentBombPassCountRef.current;
      const completed = applyPansseul(result, remainingActions);
      const stolen = await applyTurnResult(side, completed);
      await showSpecialEvents(completed.specialEvents, completed.stealPi, stolen);
    },
    [applyTurnResult, showSpecialEvents]
  );

  const handleStartGame = () => {
    if (isAnimating) return;

    const dealt = dealCards(hwatuCards);

    myCardsRef.current = dealt.playerCards;
    opponentCardsRef.current = dealt.opponentCards;
    floorCardsRef.current = dealt.floorCards;
    drawPileRef.current = dealt.drawPile;
    myCapturedCardsRef.current = [];
    opponentCapturedCardsRef.current = [];
    ppeokStacksRef.current = [];

    playerGoCountRef.current = 0;
    opponentGoCountRef.current = 0;
    playerShakeCountRef.current = 0;
    opponentShakeCountRef.current = 0;
    playerShakeMonthsRef.current = [];
    opponentShakeMonthsRef.current = [];
    playerBombCountRef.current = 0;
    opponentBombCountRef.current = 0;
    playerBombPassCountRef.current = 0;
    opponentBombPassCountRef.current = 0;

    setMyCards(dealt.playerCards);
    setOpponentCards(dealt.opponentCards);
    setFloorCards(dealt.floorCards);
    setDrawPile(dealt.drawPile);
    setMyCapturedCards([]);
    setOpponentCapturedCards([]);
    setPpeokStacks([]);
    setExpandedPpeokMonth(null);

    setPendingChoice(null);
    setSpecialActionPrompt(null);
    setFlyingCard(null);
    setPendingPlayedVisual(null);
    setCaptureFlight(null);
    setSpecialEffect(null);
    setCapturedDetailTarget(null);

    setCurrentTurn("player");
    setPlayerGoCount(0);
    setOpponentGoCount(0);
    setLastPlayerGoScore(0);
    setPlayerShakeCount(0);
    setOpponentShakeCount(0);
    setPlayerShakeMonths([]);
    setOpponentShakeMonths([]);
    setPlayerBombCount(0);
    setOpponentBombCount(0);
    setPlayerBombPassCount(0);
    setOpponentBombPassCount(0);

    setShowGoStop(false);
    setGameOver(false);
    setGameResult(null);
    setFinalMessage("");
    setSettlementResult(null);
    setTurnMessage("내 차례입니다. 카드를 한 장 선택하세요.");
    setGameStarted(true);
  };

  const finishGame = (winner: "player" | "opponent") => {
    const playerWon = winner === "player";

    const settlement = calculateSettlement(
      playerWon
        ? myCapturedCardsRef.current
        : opponentCapturedCardsRef.current,
      playerWon
        ? opponentCapturedCardsRef.current
        : myCapturedCardsRef.current,
      playerWon ? playerGoCountRef.current : opponentGoCountRef.current,
      playerWon ? opponentGoCountRef.current : playerGoCountRef.current,
      playerWon
        ? playerShakeCountRef.current
        : opponentShakeCountRef.current,
      playerWon ? playerBombCountRef.current : opponentBombCountRef.current
    );

    setSettlementResult(settlement);
    setGameOver(true);
    setGameResult(winner);
    setShowGoStop(false);
    setSpecialActionPrompt(null);
    setIsAnimating(false);

    setFinalMessage(
      playerWon
        ? `${settlement.baseScore}점으로 STOP · 최종 ${settlement.finalScore}점`
        : `상대방이 ${settlement.baseScore}점으로 STOP · 최종 ${settlement.finalScore}점`
    );

    setTurnMessage("게임이 종료되었습니다.");
  };

  const finishDraw = () => {
    const playerScore = calculateScore(myCapturedCardsRef.current).total;
    const opponentScore = calculateScore(
      opponentCapturedCardsRef.current
    ).total;

    setGameOver(true);
    setGameResult("draw");
    setSettlementResult(null);
    setShowGoStop(false);
    setSpecialActionPrompt(null);
    setIsAnimating(false);
    setFinalMessage(
      `패가 모두 소진되었습니다. 나 ${playerScore}점 · 상대 ${opponentScore}점`
    );
    setTurnMessage("나가리! 이번 판은 무승부입니다.");
  };

  const finishPlayerTurn = () => {
    const score = calculateScore(myCapturedCardsRef.current).total;
    const canDeclare =
      score >= GO_STOP_SCORE && score > lastPlayerGoScore;

    if (canDeclare) {
      setIsAnimating(false);
      setShowGoStop(true);
      setTurnMessage(`${score}점입니다. GO 또는 STOP을 선택하세요.`);
      return;
    }

    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    setIsAnimating(false);
    setCurrentTurn("opponent");
    setTurnMessage("상대방 차례입니다...");
  };

  const handleGo = () => {
    if (!showGoStop || gameOver) return;

    const currentScore = calculateScore(myCapturedCardsRef.current).total;
    const nextCount = playerGoCountRef.current + 1;

    playerGoCountRef.current = nextCount;
    setPlayerGoCount(nextCount);
    setLastPlayerGoScore(currentScore);
    setShowGoStop(false);

    if (isRoundExhausted()) {
      finishDraw();
      return;
    }

    setCurrentTurn("opponent");
    setTurnMessage(`GO! 현재 ${currentScore}점입니다. 상대방 차례입니다.`);
  };

  const handleStop = () => {
    if (!showGoStop || gameOver) return;
    finishGame("player");
  };

  const drawOnlyForPlayer = async () => {
    const currentPile = drawPileRef.current;

    if (currentPile.length === 0) {
      finishPlayerTurn();
      return;
    }

    const drawnCard = currentPile[0];
    const remainingPile = currentPile.slice(1);

    drawPileRef.current = remainingPile;
    setDrawPile(remainingPile);
    setTurnMessage("더미에서 카드를 뒤집습니다.");

    await animateFlyingCard(drawnCard, "player-draw", true);

    const result = resolveDrawOnly(
      drawnCard,
      floorCardsRef.current,
      "player",
      ppeokStacksRef.current
    );

    if (result.type === "choice") {
      setPendingChoice({
        type: "draw",
        matchingCards: result.matchingCards,
        choice: result,
      });
      setTurnMessage(
        `더미에서 ${drawnCard.month}월 카드가 나왔습니다. 가져갈 카드를 선택하세요.`
      );
      setIsAnimating(false);
      return;
    }

    await applyCompletedTurnResult("player", result);
    await sleep(GAME_SPEED.resultPause);
    finishPlayerTurn();
  };

  const continuePlayerTurn = async (prepared: PreparedPlay) => {
    floorCardsRef.current = prepared.provisionalFloorCards;
    setFloorCards(prepared.provisionalFloorCards);

    if (
      (prepared.matchCount === 1 || prepared.matchCount === 2) &&
      prepared.matchedCards.length > 0
    ) {
      setPendingPlayedVisual({
        card: prepared.playedCard,
        targetCardId: prepared.matchedCards[0].id,
        owner: "player",
      });
    } else {
      setPendingPlayedVisual(null);
    }

    const currentPile = drawPileRef.current;

    if (currentPile.length === 0) {
      const result = finalizePreparedPlay(prepared);
      await applyCompletedTurnResult("player", result);
      finishPlayerTurn();
      return;
    }

    const drawnCard = currentPile[0];
    const remainingPile = currentPile.slice(1);

    drawPileRef.current = remainingPile;
    setDrawPile(remainingPile);
    setTurnMessage("더미에서 카드를 뒤집습니다.");

    await animateFlyingCard(drawnCard, "player-draw", true);

    const drawResult = resolveTurnDraw(prepared, drawnCard);

    if (drawResult.type === "choice") {
      floorCardsRef.current = drawResult.floorCardsBeforeChoice;
      setFloorCards(drawResult.floorCardsBeforeChoice);
      setPendingChoice({
        type: "draw",
        matchingCards: drawResult.matchingCards,
        choice: drawResult,
      });
      setTurnMessage(
        `더미에서 ${drawnCard.month}월 카드가 나왔습니다. 가져갈 카드를 선택하세요.`
      );
      setIsAnimating(false);
      return;
    }

    await applyCompletedTurnResult("player", drawResult);
    await sleep(GAME_SPEED.resultPause);
    finishPlayerTurn();
  };

  const playSingleCard = async (card: HwatuCard) => {
    setIsAnimating(true);

    const nextMyCards = myCardsRef.current.filter(
      (myCard) => myCard.id !== card.id
    );

    myCardsRef.current = nextMyCards;
    setMyCards(nextMyCards);
    setTurnMessage(`${card.month}월 카드를 냅니다.`);

    await animateFlyingCard(card, "player-play", false);

    const handResult = prepareHandPlay(
      card,
      floorCardsRef.current,
      "player",
      ppeokStacksRef.current
    );

    if (handResult.type === "choice") {
      setPendingChoice({
        type: "hand",
        playedCard: card,
        matchingCards: handResult.matchingCards,
      });
      setTurnMessage("가져갈 바닥패를 선택하세요.");
      setIsAnimating(false);
      return;
    }

    await continuePlayerTurn(handResult.prepared);
  };

  const handlePlayCard = async (card: HwatuCard) => {
    if (
      !gameStarted ||
      gameOver ||
      showGoStop ||
      specialActionPrompt ||
      playerBombPassCountRef.current > 0 ||
      currentTurn !== "player" ||
      pendingChoice ||
      isAnimating
    ) {
      return;
    }

    const bombAction = getBombActionForMonth(
      myCardsRef.current,
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
      canShakeMonth(myCardsRef.current, floorCardsRef.current, card.month)
    ) {
      setSpecialActionPrompt({
        type: "shake",
        card,
        month: card.month,
      });
      setTurnMessage(`${card.month}월 세 장을 흔들 수 있습니다.`);
      return;
    }

    await playSingleCard(card);
  };

  const executePlayerBomb = async (month: number) => {
    const action = getBombActionForMonth(
      myCardsRef.current,
      floorCardsRef.current,
      month
    );

    setSpecialActionPrompt(null);

    if (!action) {
      setTurnMessage("폭탄 조건이 더 이상 성립하지 않습니다.");
      return;
    }

    setIsAnimating(true);

    const bombIds = new Set(action.handCards.map((card) => card.id));
    const nextHand = myCardsRef.current.filter((card) => !bombIds.has(card.id));
    const nextFloor = floorCardsRef.current.filter(
      (card) => card.id !== action.floorCard.id
    );

    myCardsRef.current = nextHand;
    setMyCards(nextHand);

    const nextBombCount = playerBombCountRef.current + 1;
    const nextBombPasses = playerBombPassCountRef.current + 2;

    playerBombCountRef.current = nextBombCount;
    playerBombPassCountRef.current = nextBombPasses;
    setPlayerBombCount(nextBombCount);
    setPlayerBombPassCount(nextBombPasses);

    const bombResult: TurnCompleteResult = {
      type: "complete",
      floorCards: nextFloor,
      capturedCards: [...action.handCards, action.floorCard],
      stealPi: 1,
      specialEvents: ["bomb"],
      ppeokStacks: ppeokStacksRef.current,
    };

    const stolen = await applyTurnResult("player", bombResult);
    await showSpecialEvents(["bomb"], 1, stolen);
    await sleep(GAME_SPEED.bombPause);

    await drawOnlyForPlayer();
  };

  const handleSpecialActionConfirm = async () => {
    if (!specialActionPrompt || gameOver || isAnimating) return;

    const prompt = specialActionPrompt;

    if (prompt.type === "bomb") {
      await executePlayerBomb(prompt.month);
      return;
    }

    setSpecialActionPrompt(null);
    setIsAnimating(true);

    const nextShakeCount = playerShakeCountRef.current + 1;
    playerShakeCountRef.current = nextShakeCount;
    setPlayerShakeCount(nextShakeCount);

    const nextShakeMonths = [
      ...playerShakeMonthsRef.current,
      prompt.month,
    ];
    playerShakeMonthsRef.current = nextShakeMonths;
    setPlayerShakeMonths(nextShakeMonths);

    await showShakeReveal("player", prompt.month);
    await playSingleCard(prompt.card);
  };

  const handleSpecialActionNormal = async () => {
    if (!specialActionPrompt || gameOver || isAnimating) return;

    const card = specialActionPrompt.card;
    setSpecialActionPrompt(null);
    await playSingleCard(card);
  };

  const handleBombPass = async () => {
    if (
      !gameStarted ||
      gameOver ||
      currentTurn !== "player" ||
      pendingChoice ||
      isAnimating ||
      playerBombPassCountRef.current <= 0
    ) {
      return;
    }

    setIsAnimating(true);

    const nextPassCount = playerBombPassCountRef.current - 1;
    playerBombPassCountRef.current = nextPassCount;
    setPlayerBombPassCount(nextPassCount);

    await showSpecialEvents(["bomb-pass"]);
    await drawOnlyForPlayer();
  };

  const handleFloorCardChoice = async (selectedCard: HwatuCard) => {
    if (!pendingChoice || isAnimating || gameOver) return;

    const canSelect = pendingChoice.matchingCards.some(
      (card) => card.id === selectedCard.id
    );

    if (!canSelect) return;

    setIsAnimating(true);

    if (pendingChoice.type === "hand") {
      const playedCard = pendingChoice.playedCard;
      setPendingChoice(null);

      const handResult = prepareHandPlay(
        playedCard,
        floorCardsRef.current,
        "player",
        ppeokStacksRef.current,
        selectedCard.id
      );

      if (handResult.type === "choice") {
        setIsAnimating(false);
        return;
      }

      await continuePlayerTurn(handResult.prepared);
      return;
    }

    const result = resolveDrawChoice(pendingChoice.choice, selectedCard);
    setPendingChoice(null);

    await applyCompletedTurnResult("player", result);
    await sleep(GAME_SPEED.resultPause);
    finishPlayerTurn();
  };

  useEffect(() => {
    if (!gameStarted || gameOver || currentTurn !== "opponent") return;

    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;

        setIsAnimating(true);
        setTurnMessage("상대방이 카드를 고르는 중...");
        await sleep(GAME_SPEED.opponentThink);

        if (cancelled) return;

        const finishOpponentAction = async () => {
          await sleep(GAME_SPEED.opponentAfterAction);

          if (cancelled) return;

          const opponentScore = calculateScore(
            opponentCapturedCardsRef.current
          ).total;

          if (opponentScore >= GO_STOP_SCORE) {
            setIsAnimating(false);
            setTurnMessage(
              `상대방이 ${opponentScore}점에서 STOP을 선언했습니다.`
            );
            await sleep(GAME_SPEED.opponentStopHold);
            finishGame("opponent");
            return;
          }

          if (isRoundExhausted()) {
            finishDraw();
            return;
          }

          setIsAnimating(false);
          setCurrentTurn("player");

          if (playerBombPassCountRef.current > 0) {
            setTurnMessage(
              `내 차례입니다. 폭탄 패가 ${playerBombPassCountRef.current}장 남았습니다.`
            );
          } else {
            setTurnMessage("내 차례입니다. 카드를 한 장 선택하세요.");
          }
        };

        const doOpponentDrawOnly = async () => {
          const currentPile = drawPileRef.current;

          if (currentPile.length === 0) {
            await finishOpponentAction();
            return;
          }

          const drawnCard = currentPile[0];
          const remainingPile = currentPile.slice(1);

          drawPileRef.current = remainingPile;
          setDrawPile(remainingPile);
          setTurnMessage("상대방이 더미에서 카드를 뒤집습니다.");

          await animateFlyingCard(drawnCard, "opponent-draw", true);

          if (cancelled) return;

          const drawResult = resolveDrawOnly(
            drawnCard,
            floorCardsRef.current,
            "opponent",
            ppeokStacksRef.current
          );

          let completeResult: TurnCompleteResult;

          if (drawResult.type === "choice") {
            const selected =
              drawResult.matchingCards[
                Math.floor(Math.random() * drawResult.matchingCards.length)
              ];
            completeResult = resolveDrawChoice(drawResult, selected);
          } else {
            completeResult = drawResult;
          }

          await applyCompletedTurnResult("opponent", completeResult);
          await finishOpponentAction();
        };

        /* 폭탄 이후 생성된 폭탄 패: 손패를 내지 않고 더미만 뒤집기 */
        if (opponentBombPassCountRef.current > 0) {
          const nextPassCount = opponentBombPassCountRef.current - 1;
          opponentBombPassCountRef.current = nextPassCount;
          setOpponentBombPassCount(nextPassCount);

          await showSpecialEvents(["bomb-pass"]);
          await doOpponentDrawOnly();
          return;
        }

        const currentOpponentCards = opponentCardsRef.current;

        if (currentOpponentCards.length === 0) {
          setIsAnimating(false);

          if (isRoundExhausted()) {
            finishDraw();
          } else {
            setCurrentTurn("player");
          }
          return;
        }

        /* 폭탄 가능하면 AI는 테스트를 위해 자동 사용 */
        const bombAction = findBombAction(
          currentOpponentCards,
          floorCardsRef.current
        );

        if (bombAction) {
          const bombIds = new Set(bombAction.handCards.map((card) => card.id));
          const nextOpponentHand = currentOpponentCards.filter(
            (card) => !bombIds.has(card.id)
          );
          const nextFloor = floorCardsRef.current.filter(
            (card) => card.id !== bombAction.floorCard.id
          );

          opponentCardsRef.current = nextOpponentHand;
          setOpponentCards(nextOpponentHand);

          const nextBombCount = opponentBombCountRef.current + 1;
          const nextBombPasses = opponentBombPassCountRef.current + 2;

          opponentBombCountRef.current = nextBombCount;
          opponentBombPassCountRef.current = nextBombPasses;
          setOpponentBombCount(nextBombCount);
          setOpponentBombPassCount(nextBombPasses);

          setTurnMessage("상대방이 폭탄을 사용합니다!");

          for (const card of bombAction.handCards) {
            await animateFlyingCard(card, "opponent-play", true);
            if (cancelled) return;
          }

          const bombResult: TurnCompleteResult = {
            type: "complete",
            floorCards: nextFloor,
            capturedCards: [...bombAction.handCards, bombAction.floorCard],
            stealPi: 1,
            specialEvents: ["bomb"],
            ppeokStacks: ppeokStacksRef.current,
          };

          const stolen = await applyTurnResult("opponent", bombResult);
          await showSpecialEvents(["bomb"], 1, stolen);
          await doOpponentDrawOnly();
          return;
        }

        /* 폭탄이 없고 흔들기 가능하면 AI는 자동 흔들기 */
        const shakeMonth = findShakeMonth(
          currentOpponentCards,
          floorCardsRef.current
        );

        let playedCard: HwatuCard;

        if (shakeMonth !== null) {
          const shakeCards = currentOpponentCards.filter(
            (card) => card.month === shakeMonth
          );

          playedCard = shakeCards[
            Math.floor(Math.random() * shakeCards.length)
          ];

          const nextShakeCount = opponentShakeCountRef.current + 1;
          opponentShakeCountRef.current = nextShakeCount;
          setOpponentShakeCount(nextShakeCount);

          const nextShakeMonths = [
            ...opponentShakeMonthsRef.current,
            shakeMonth,
          ];
          opponentShakeMonthsRef.current = nextShakeMonths;
          setOpponentShakeMonths(nextShakeMonths);

          await showShakeReveal("opponent", shakeMonth);
        } else {
          playedCard =
            currentOpponentCards[
              Math.floor(Math.random() * currentOpponentCards.length)
            ];
        }

        const nextOpponentHand = currentOpponentCards.filter(
          (card) => card.id !== playedCard.id
        );

        opponentCardsRef.current = nextOpponentHand;
        setOpponentCards(nextOpponentHand);
        setTurnMessage("상대방이 카드를 냅니다.");

        await animateFlyingCard(playedCard, "opponent-play", true);

        if (cancelled) return;

        let handResult = prepareHandPlay(
          playedCard,
          floorCardsRef.current,
          "opponent",
          ppeokStacksRef.current
        );

        if (handResult.type === "choice") {
          const selected =
            handResult.matchingCards[
              Math.floor(Math.random() * handResult.matchingCards.length)
            ];

          handResult = prepareHandPlay(
            playedCard,
            floorCardsRef.current,
            "opponent",
            ppeokStacksRef.current,
            selected.id
          );
        }

        if (handResult.type !== "ready") {
          setIsAnimating(false);
          return;
        }

        const prepared = handResult.prepared;
        floorCardsRef.current = prepared.provisionalFloorCards;
        setFloorCards(prepared.provisionalFloorCards);

        if (
          (prepared.matchCount === 1 || prepared.matchCount === 2) &&
          prepared.matchedCards.length > 0
        ) {
          setPendingPlayedVisual({
            card: prepared.playedCard,
            targetCardId: prepared.matchedCards[0].id,
            owner: "opponent",
          });
        } else {
          setPendingPlayedVisual(null);
        }

        const currentPile = drawPileRef.current;
        let completeResult: TurnCompleteResult;

        if (currentPile.length === 0) {
          completeResult = finalizePreparedPlay(prepared);
        } else {
          const drawnCard = currentPile[0];
          const remainingPile = currentPile.slice(1);

          drawPileRef.current = remainingPile;
          setDrawPile(remainingPile);
          setTurnMessage("상대방이 더미에서 카드를 뒤집습니다.");

          await animateFlyingCard(drawnCard, "opponent-draw", true);

          if (cancelled) return;

          const drawResult = resolveTurnDraw(prepared, drawnCard);

          if (drawResult.type === "choice") {
            const selected =
              drawResult.matchingCards[
                Math.floor(Math.random() * drawResult.matchingCards.length)
              ];
            completeResult = resolveDrawChoice(drawResult, selected);
          } else {
            completeResult = drawResult;
          }
        }

        await applyCompletedTurnResult("opponent", completeResult);
        await finishOpponentAction();
      })();
    }, GAME_SPEED.opponentTurnDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    gameStarted,
    gameOver,
    currentTurn,
    animateFlyingCard,
    applyCompletedTurnResult,
    applyTurnResult,
    showSpecialEvents,
    showShakeReveal,
  ]);

  useEffect(() => {
    if (
      expandedPpeokMonth !== null &&
      !ppeokStacks.some((stack) => stack.month === expandedPpeokMonth)
    ) {
      setExpandedPpeokMonth(null);
    }
  }, [expandedPpeokMonth, ppeokStacks]);

  const myScore = calculateScore(myCapturedCards);
  const opponentScore = calculateScore(opponentCapturedCards);

  const detailCards =
    capturedDetailTarget === "player"
      ? myCapturedCards
      : opponentCapturedCards;

  const detailTitle =
    capturedDetailTarget === "player" ? "내 먹은 패" : "상대 먹은 패";

  const detailGoCount =
    capturedDetailTarget === "player" ? playerGoCount : opponentGoCount;

  const detailShakeMonths =
    capturedDetailTarget === "player"
      ? playerShakeMonths
      : opponentShakeMonths;

  const detailBombCount =
    capturedDetailTarget === "player" ? playerBombCount : opponentBombCount;

  return (
    <main
      className={`game ${isAnimating ? "is-animating" : ""}`}
      style={GAME_SPEED_STYLE}
    >
      {specialEffect && <div className="special-effect">{specialEffect}</div>}

      {capturedDetailTarget && (
        <CapturedCardsModal
          title={detailTitle}
          cards={detailCards}
          goCount={detailGoCount}
          shakeMonths={detailShakeMonths}
          bombCount={detailBombCount}
          onClose={() => setCapturedDetailTarget(null)}
        />
      )}

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

      {captureFlight && (
        <div className="capture-flight-layer" aria-hidden="true">
          <div
            className={`capture-flight capture-flight--${captureFlight.side}`}
          >
            {captureFlight.cards.map((card, index) => (
              <div
                key={`${card.id}-${index}`}
                className="capture-flight-card"
                style={{
                  left: `${index * 10}px`,
                  top: `${index * 4}px`,
                }}
              >
                <Card card={card} />
              </div>
            ))}
          </div>
        </div>
      )}

      {specialActionPrompt && !gameOver && (
        <div className="special-action-overlay">
          <div className="special-action-modal">
            <span className="special-action-label">
              {specialActionPrompt.month}월 특수 행동
            </span>

            <h2>
              {specialActionPrompt.type === "bomb" ? "폭탄 가능!" : "흔들기 가능!"}
            </h2>

            <p>
              {specialActionPrompt.type === "bomb"
                ? "같은 월 손패 3장을 한꺼번에 내고 바닥의 나머지 1장을 먹습니다."
                : "같은 월 세 장을 공개하고 한 장을 냅니다. 이 판에서 이기면 정산 배수가 2배가 됩니다."}
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

      {showGoStop && !gameOver && (
        <div className="go-stop-overlay">
          <div className="go-stop-modal">
            <span className="go-stop-small">현재 점수</span>
            <strong className="go-stop-score">{myScore.total}점</strong>
            <p>GO를 선언하고 계속하시겠습니까?</p>

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
              {gameResult === "player" && "승리!"}
              {gameResult === "opponent" && "패배"}
              {gameResult === "draw" && "나가리"}
            </h2>

            <p>{finalMessage}</p>

            <div className="game-over-score-board">
              <div>
                <span>나</span>
                <strong>{myScore.total}점</strong>
                <small>
                  {playerGoCount}GO · 흔들기 {playerShakeCount}
                  {playerShakeMonths.length > 0 &&
                    ` (${playerShakeMonths.map((month) => `${month}월`).join(", ")})`}
                  {` · 폭탄 ${playerBombCount}`}
                </small>
              </div>

              <div>
                <span>상대방</span>
                <strong>{opponentScore.total}점</strong>
                <small>
                  {opponentGoCount}GO · 흔들기 {opponentShakeCount}
                  {opponentShakeMonths.length > 0 &&
                    ` (${opponentShakeMonths.map((month) => `${month}월`).join(", ")})`}
                  {` · 폭탄 ${opponentBombCount}`}
                </small>
              </div>
            </div>

            {settlementResult && gameResult !== "draw" && (
              <div className="settlement-board">
                <div className="settlement-title">최종 정산</div>

                <div className="settlement-row">
                  <span>기본 패 점수</span>
                  <strong>{settlementResult.baseScore}점</strong>
                </div>

                {settlementResult.goBonus > 0 && (
                  <div className="settlement-row">
                    <span>GO 추가 점수</span>
                    <strong>+{settlementResult.goBonus}점</strong>
                  </div>
                )}

                <div className="settlement-divider" />

                {settlementResult.multipliers.length === 0 ? (
                  <div className="settlement-no-bak">
                    적용된 배수가 없습니다.
                  </div>
                ) : (
                  <div className="settlement-multipliers">
                    {settlementResult.multipliers.map((item) => (
                      <div key={item.id} className="settlement-multiplier">
                        <span>{item.label}</span>
                        <strong>×{item.multiplier}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <div className="settlement-total">
                  <span>최종 정산 점수</span>
                  <strong>{settlementResult.finalScore}점</strong>
                </div>
              </div>
            )}

            {gameResult === "draw" && (
              <div className="nagari-message">이번 판은 무승부입니다.</div>
            )}

            <button
              type="button"
              className="restart-game-button"
              onClick={handleStartGame}
            >
              다시 시작
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="start-button"
        onClick={handleStartGame}
        disabled={isAnimating || showGoStop || Boolean(specialActionPrompt)}
      >
        {gameStarted ? "다시 시작" : "게임 시작"}
      </button>

      {gameStarted && (
        <>
          <CapturedPanel
            title="상대 먹은 패"
            cards={opponentCapturedCards}
            score={opponentScore}
            side="left"
            goCount={opponentGoCount}
            shakeCount={opponentShakeCount}
            shakeMonths={opponentShakeMonths}
            bombCount={opponentBombCount}
            onOpenDetails={() => setCapturedDetailTarget("opponent")}
          />

          <CapturedPanel
            title="내 먹은 패"
            cards={myCapturedCards}
            score={myScore}
            side="right"
            goCount={playerGoCount}
            shakeCount={playerShakeCount}
            shakeMonths={playerShakeMonths}
            bombCount={playerBombCount}
            onOpenDetails={() => setCapturedDetailTarget("player")}
          />
        </>
      )}

      <section className="opponent-area">
        <h2>
          상대방
          {currentTurn === "opponent" && gameStarted && !gameOver && " ◀"}
        </h2>

        <div className="card-row">
          {opponentCards.map((card) => (
            <Card key={card.id} isBack />
          ))}
        </div>

        {gameStarted && (
          <p>
            손패 {opponentCards.length}장 · 점수 {opponentScore.total}점 · GO {opponentGoCount}회
            {opponentBombPassCount > 0 && ` · 폭탄패 ${opponentBombPassCount}`}
          </p>
        )}
      </section>

      <MatgoTable floorCards={floorCards} ppeokStacks={ppeokStacks}
        expandedPpeokMonth={expandedPpeokMonth} setExpandedPpeokMonth={setExpandedPpeokMonth}
        pendingChoice={pendingChoice} pendingPlayedVisual={pendingPlayedVisual}
        turnMessage={turnMessage} isAnimating={isAnimating} gameOver={gameOver}
        gameStarted={gameStarted} drawCount={drawPile.length} handleFloorCardChoice={handleFloorCardChoice} />

      <section className="player-area">
        <h2>
          내 패
          {currentTurn === "player" && gameStarted && !gameOver && " ◀"}
        </h2>

        {gameStarted &&
          currentTurn === "player" &&
          playerBombPassCount > 0 &&
          !gameOver && (
            <button
              type="button"
              className="bomb-pass-button"
              onClick={() => void handleBombPass()}
              disabled={isAnimating || Boolean(pendingChoice)}
            >
              폭탄 패 사용 · 더미만 뒤집기 ({playerBombPassCount})
            </button>
          )}

        <div className="card-row">
          {myCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              onClick={
                currentTurn === "player" &&
                !pendingChoice &&
                !isAnimating &&
                !showGoStop &&
                !specialActionPrompt &&
                !gameOver &&
                playerBombPassCount === 0
                  ? () => void handlePlayCard(card)
                  : undefined
              }
            />
          ))}
        </div>

        {gameStarted && (
          <p>
            손패 {myCards.length}장 · 점수 {myScore.total}점 · GO {playerGoCount}회
            {playerBombPassCount > 0 && ` · 폭탄패 ${playerBombPassCount}`}
          </p>
        )}
      </section>
    </main>
  );
}

export default MatgoGame;
