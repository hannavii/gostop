import type { CSSProperties, Dispatch, SetStateAction } from "react";
import Card from "./Card";
import type { HwatuCard } from "../types/game";
import type { PpeokStack } from "../game/turn";
type Turn = "player" | "opponent";
type FloorDisplayItem =
  | {
      type: "card";
      card: HwatuCard;
    }
  | {
      type: "ppeok";
      month: number;
      cards: HwatuCard[];
      owner: Turn;
    };
type Props = {
 floorCards: HwatuCard[]; ppeokStacks: PpeokStack[];
 expandedPpeokMonth: number | null;
 setExpandedPpeokMonth: Dispatch<SetStateAction<number | null>>;
 pendingChoice: { matchingCards: HwatuCard[] } | null;
 pendingPlayedVisual?: { card: HwatuCard; targetCardId: string; owner: Turn } | null;
 turnMessage: string; isAnimating: boolean; gameOver: boolean;
 gameStarted: boolean; drawCount: number;
 handleFloorCardChoice: (card: HwatuCard) => void | Promise<void>;
};
export default function MatgoTable({floorCards,ppeokStacks,expandedPpeokMonth,setExpandedPpeokMonth,pendingChoice,pendingPlayedVisual,turnMessage,isAnimating,gameOver,gameStarted,drawCount,handleFloorCardChoice}: Props) {
  const floorDisplayItems: FloorDisplayItem[] = [];
  const renderedPpeokMonths = new Set<number>();

  floorCards.forEach((card) => {
    const ppeokStack = ppeokStacks.find((stack) => stack.month === card.month);

    if (ppeokStack) {
      if (renderedPpeokMonths.has(card.month)) {
        return;
      }

      renderedPpeokMonths.add(card.month);

      floorDisplayItems.push({
        type: "ppeok",
        month: card.month,
        cards: floorCards.filter((floorCard) => floorCard.month === card.month),
        owner: ppeokStack.owner,
      });

      return;
    }

    floorDisplayItems.push({
      type: "card",
      card,
    });
  });


 return (
      <section className="table">
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

        {turnMessage && <div className="turn-message">{turnMessage}</div>}

        <div className="table-content">
          <div className="floor-cards">
            {floorDisplayItems.map((item) => {
              if (item.type === "ppeok") {
                const isExpanded = expandedPpeokMonth === item.month;

                return (
                  <div
                    key={`ppeok-${item.month}`}
                    className={`ppeok-stack-slot ${isExpanded ? "is-open" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={`${item.month}월 뻑 ${item.cards.length}장. ${
                      item.owner === "player" ? "내가 만든 뻑" : "상대가 만든 뻑"
                    }. 클릭하면 카드 목록을 ${isExpanded ? "닫습니다" : "봅니다"}.`}
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
                      <span>{item.cards.length}장 · {item.owner === "player" ? "내 뻑" : "상대 뻑"}</span>
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
                        {item.owner === "player"
                          ? "내가 만든 뻑입니다."
                          : "상대방이 만든 뻑입니다."}
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
                      isSelectable && !isAnimating && !gameOver
                        ? () => void handleFloorCardChoice(card)
                        : undefined
                    }
                  />

                  {hasPlayedOverlay && pendingPlayedVisual && (
                    <div
                      className={`played-card-overlay played-card-overlay--${pendingPlayedVisual.owner}`}
                    >
                      <Card card={pendingPlayedVisual.card} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {gameStarted && (
            <div className="draw-pile-area">
              {drawCount > 0 && <Card isBack />}
              <span>더미 {drawCount}장</span>
            </div>
          )}
        </div>
      </section>

);
}
