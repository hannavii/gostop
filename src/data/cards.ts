import type {
  CardCategory,
  CardTag,
  HwatuCard,
} from "../types/game";

function createCard(
  month: number,
  cardIndex: number,
  category: CardCategory,
  tags: CardTag[] = []
): HwatuCard {
  return {
    id: `${month}-${cardIndex}`,
    month,
    cardIndex,
    category,
    tags,
  };
}

export const hwatuCards: HwatuCard[] = [
  // =====================
  // 1월 - 송학
  // =====================
  createCard(1, 1, "gwang"),
  createCard(1, 2, "ribbon", ["hongdan"]),
  createCard(1, 3, "pi"),
  createCard(1, 4, "pi"),

  // =====================
  // 2월 - 매조
  // =====================
  createCard(2, 1, "animal", ["godori"]),
  createCard(2, 2, "ribbon", ["hongdan"]),
  createCard(2, 3, "pi"),
  createCard(2, 4, "pi"),

  // =====================
  // 3월 - 벚꽃
  // =====================
  createCard(3, 1, "gwang"),
  createCard(3, 2, "ribbon", ["hongdan"]),
  createCard(3, 3, "pi"),
  createCard(3, 4, "pi"),

  // =====================
  // 4월
  // =====================
  createCard(4, 1, "animal", ["godori"]),
  createCard(4, 2, "ribbon", ["chodan"]),
  createCard(4, 3, "pi"),
  createCard(4, 4, "pi"),

  // =====================
  // 5월
  // =====================
  createCard(5, 1, "animal"),
  createCard(5, 2, "ribbon", ["chodan"]),
  createCard(5, 3, "pi"),
  createCard(5, 4, "pi"),

  // =====================
  // 6월
  // =====================
  createCard(6, 1, "animal"),
  createCard(6, 2, "ribbon", ["cheongdan"]),
  createCard(6, 3, "pi"),
  createCard(6, 4, "pi"),

  // =====================
  // 7월
  // =====================
  createCard(7, 1, "animal"),
  createCard(7, 2, "ribbon", ["chodan"]),
  createCard(7, 3, "pi"),
  createCard(7, 4, "pi"),

  // =====================
  // 8월
  // =====================
  createCard(8, 1, "gwang"),
  createCard(8, 2, "animal", ["godori"]),
  createCard(8, 3, "pi"),
  createCard(8, 4, "pi"),

  // =====================
  // 9월
  // =====================
  createCard(9, 1, "animal", ["sake-cup"]),
  createCard(9, 2, "ribbon", ["cheongdan"]),
  createCard(9, 3, "pi"),
  createCard(9, 4, "pi"),

  // =====================
  // 10월
  // =====================
  createCard(10, 1, "animal"),
  createCard(10, 2, "ribbon", ["cheongdan"]),
  createCard(10, 3, "pi"),
  createCard(10, 4, "pi"),

  // =====================
  // 11월 - 오동
  // =====================
  createCard(11, 1, "gwang"),
  createCard(11, 2, "pi", ["double-pi"]),
  createCard(11, 3, "pi"),
  createCard(11, 4, "pi"),

  // =====================
  // 12월 - 비
  // =====================
  createCard(12, 1, "gwang", ["rain-gwang"]),
  createCard(12, 2, "animal"),
  createCard(12, 3, "ribbon"),
  createCard(12, 4, "pi", ["double-pi"]),
];