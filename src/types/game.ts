export type CardCategory =
  | "gwang"
  | "animal"
  | "ribbon"
  | "pi";

export type CardTag =
  | "rain-gwang"
  | "godori"
  | "hongdan"
  | "cheongdan"
  | "chodan"
  | "double-pi"
  | "sake-cup";

export type HwatuCard = {
  id: string;
  month: number;
  cardIndex: number;

  category: CardCategory;

  tags: CardTag[];
};