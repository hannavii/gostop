import type { SpecialEvent } from "../game/turn";
export function getSpecialEventName(event: SpecialEvent) {
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

