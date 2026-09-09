import { useEffect } from "react";

import Card from "./Card";
import { calculateScore } from "../game/scoring";
import type { HwatuCard } from "../types/game";

type CapturedCardsModalProps = {
  title: string;
  cards: HwatuCard[];
  goCount?: number;
  shakeMonths?: number[];
  bombCount?: number;
  onClose: () => void;
};

function getCardLabel(card: HwatuCard): string {
  if (card.category === "gwang") {
    return card.tags.includes("rain-gwang") ? "비광" : "광";
  }

  if (card.category === "animal") {
    if (card.tags.includes("godori")) return "고도리";
    if (card.tags.includes("sake-cup")) return "술잔";
    return "열끗";
  }

  if (card.category === "ribbon") {
    if (card.tags.includes("hongdan")) return "홍단";
    if (card.tags.includes("cheongdan")) return "청단";
    if (card.tags.includes("chodan")) return "초단";
    return "띠";
  }

  return card.tags.includes("double-pi") ? "쌍피" : "피";
}

function CapturedCardsModal({
  title,
  cards,
  goCount = 0,
  shakeMonths = [],
  bombCount = 0,
  onClose,
}: CapturedCardsModalProps) {
  const score = calculateScore(cards);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const groups = [
    {
      key: "gwang",
      name: "광",
      cards: cards.filter((card) => card.category === "gwang"),
    },
    {
      key: "animal",
      name: "열끗",
      cards: cards.filter((card) => card.category === "animal"),
    },
    {
      key: "ribbon",
      name: "띠",
      cards: cards.filter((card) => card.category === "ribbon"),
    },
    {
      key: "pi",
      name: "피",
      cards: cards.filter((card) => card.category === "pi"),
    },
  ];

  return (
    <div
      className="capture-zoom-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="capture-zoom-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 크게 보기`}
      >
        <header className="capture-zoom-header">
          <div>
            <h2>{title}</h2>

            <div className="capture-zoom-summary">
              <span>{cards.length}장</span>
              <span>{score.total}점</span>

              {goCount > 0 && <span>{goCount} GO</span>}
              {bombCount > 0 && <span>폭탄 {bombCount}</span>}
              {shakeMonths.length > 0 && (
                <span>흔들기 {shakeMonths.length}</span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="capture-zoom-close"
            onClick={onClose}
            aria-label="먹은 패 크게 보기 닫기"
          >
            ×
          </button>
        </header>

        {shakeMonths.length > 0 && (
          <div className="capture-zoom-shakes">
            <strong>흔들기 공개</strong>

            <div>
              {shakeMonths.map((month, index) => (
                <span key={`${month}-${index}`}>{month}월 ×3</span>
              ))}
            </div>
          </div>
        )}

        <div className="capture-zoom-groups">
          {groups.map((group) => (
            <div key={group.key} className="capture-zoom-row">
              <div className="capture-zoom-row-title">
                <strong>{group.name}</strong>
                <span>{group.cards.length}</span>
              </div>

              <div className="capture-zoom-cards">
                {group.cards.length === 0 ? (
                  <span className="capture-zoom-empty">-</span>
                ) : (
                  group.cards.map((card) => (
                    <div
                      key={card.id}
                      className="capture-zoom-card"
                      title={`${card.month}월 ${getCardLabel(card)}`}
                    >
                      <Card card={card} />
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="capture-zoom-help">
          바깥 영역이나 ×를 누르면 닫힙니다.
        </p>
      </section>
    </div>
  );
}

export default CapturedCardsModal;
