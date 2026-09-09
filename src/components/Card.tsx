import type { HwatuCard } from "../types/game";

type CardProps = {
  card?: HwatuCard;
  isBack?: boolean;
  isSelectable?: boolean;
  onClick?: () => void;
};

function getCardTypeLabel(card: HwatuCard): string {
  // 광
  if (card.category === "gwang") {
    if (card.tags.includes("rain-gwang")) {
      return "비광";
    }

    return "광";
  }

  // 열끗
  if (card.category === "animal") {
    if (card.tags.includes("godori")) {
      return "고도리";
    }

    if (card.tags.includes("sake-cup")) {
      return "술잔";
    }

    return "열끗";
  }

  // 띠
  if (card.category === "ribbon") {
    if (card.tags.includes("hongdan")) {
      return "홍단";
    }

    if (card.tags.includes("cheongdan")) {
      return "청단";
    }

    if (card.tags.includes("chodan")) {
      return "초단";
    }

    return "띠";
  }

  // 피
  if (card.category === "pi") {
    if (card.tags.includes("double-pi")) {
      return "쌍피";
    }

    return "피";
  }

  return "";
}

function Card({
  card,
  isBack = false,
  isSelectable = false,
  onClick,
}: CardProps) {
  if (isBack) {
    return <div className="card-back" />;
  }

  if (!card) {
    return null;
  }

  const typeLabel = getCardTypeLabel(card);

  const className = [
    "card",
    `card--${card.category}`,
    isSelectable ? "selectable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="card-month">
        {card.month}월
      </span>

      <strong className="card-type">
        {typeLabel}
      </strong>

      <span className="card-index">
        {card.cardIndex}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

export default Card;