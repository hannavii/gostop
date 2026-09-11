import type { HwatuCard } from "../types/game";
import type { calculateScore } from "../game/scoring";
type ScoreResult = ReturnType<typeof calculateScore>;
type CapturedPanelProps = {
  title: string;
  cards: HwatuCard[];
  score: Pick<ScoreResult, "total"> & Partial<ScoreResult>;
  side: "left" | "right";
  position?: "opponent1" | "opponent2" | "player";
  goCount: number;
  shakeCount: number;
  shakeMonths: number[];
  bombCount: number;
  onOpenDetails: () => void;
};

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

export default function CapturedPanel({
  title,
  cards,
  score,
  side,
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

  if ((score.gwangScore ?? 0) > 0) {
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
      className={`captured-panel captured-panel--clickable ${position ? `gostop3-captured-panel gostop3-captured-panel--${position}` : `captured-panel--${side}`}`}
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

