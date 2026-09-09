import { calculateScore } from "./scoring";
import type { HwatuCard } from "../types/game";

export type SettlementMultiplier = {
  id:
    | "go"
    | "shake-bomb"
    | "gwang-bak"
    | "pi-bak"
    | "meong-bak"
    | "go-bak";
  label: string;
  multiplier: number;
};

export type SettlementResult = {
  baseScore: number;
  goBonus: number;
  scoreBeforeMultipliers: number;
  totalMultiplier: number;
  finalScore: number;
  multipliers: SettlementMultiplier[];

  gwangBak: boolean;
  piBak: boolean;
  meongBak: boolean;
  goBak: boolean;

  winnerGoCount: number;
  loserGoCount: number;
  winnerShakeCount: number;
  winnerBombCount: number;
};

/*
 * 현재 프로젝트의 맞고 피박 면제 기준입니다.
 * 나중에 GAME_RULES로 분리할 수 있습니다.
 */
const MATGO_PI_BAK_SAFE_COUNT = 7;

export function calculateSettlement(
  winnerCards: HwatuCard[],
  loserCards: HwatuCard[],
  winnerGoCount: number,
  loserGoCount: number,
  winnerShakeCount = 0,
  winnerBombCount = 0
): SettlementResult {
  const winnerScore = calculateScore(winnerCards);
  const loserScore = calculateScore(loserCards);

  const baseScore = winnerScore.total;

  /* 1고 +1, 2고 이상 +2. 3고부터의 배수는 아래에서 별도 적용 */
  const goBonus = Math.min(winnerGoCount, 2);
  const scoreBeforeMultipliers = baseScore + goBonus;

  const multipliers: SettlementMultiplier[] = [];

  /* 3고 x2, 4고 x4, 5고 x8 ... */
  if (winnerGoCount >= 3) {
    multipliers.push({
      id: "go",
      label: `${winnerGoCount}고`,
      multiplier: 2 ** (winnerGoCount - 2),
    });
  }

  /*
   * 흔들기와 폭탄은 각각 승리 시 x2.
   * 둘 이상 선언했다면 배수가 중첩됩니다.
   */
  const shakeBombCount = winnerShakeCount + winnerBombCount;

  if (shakeBombCount > 0) {
    const parts: string[] = [];

    if (winnerShakeCount > 0) {
      parts.push(`흔들기 ${winnerShakeCount}회`);
    }

    if (winnerBombCount > 0) {
      parts.push(`폭탄 ${winnerBombCount}회`);
    }

    multipliers.push({
      id: "shake-bomb",
      label: parts.join(" · "),
      multiplier: 2 ** shakeBombCount,
    });
  }

  const gwangBak =
    winnerScore.gwangScore > 0 && loserScore.gwangCount === 0;

  if (gwangBak) {
    multipliers.push({
      id: "gwang-bak",
      label: "광박",
      multiplier: 2,
    });
  }

  const piBak =
    winnerScore.piScore > 0 &&
    loserScore.piCount < MATGO_PI_BAK_SAFE_COUNT;

  if (piBak) {
    multipliers.push({
      id: "pi-bak",
      label: "피박",
      multiplier: 2,
    });
  }

  const meongBak = winnerScore.animalCount >= 7;

  if (meongBak) {
    multipliers.push({
      id: "meong-bak",
      label: "멍박",
      multiplier: 2,
    });
  }

  /* 프로젝트용 2인 고박 규칙: 패자가 이전에 GO를 한 상태면 x2 */
  const goBak = loserGoCount > 0;

  if (goBak) {
    multipliers.push({
      id: "go-bak",
      label: "고박",
      multiplier: 2,
    });
  }

  const totalMultiplier = multipliers.reduce(
    (total, item) => total * item.multiplier,
    1
  );

  return {
    baseScore,
    goBonus,
    scoreBeforeMultipliers,
    totalMultiplier,
    finalScore: scoreBeforeMultipliers * totalMultiplier,
    multipliers,
    gwangBak,
    piBak,
    meongBak,
    goBak,
    winnerGoCount,
    loserGoCount,
    winnerShakeCount,
    winnerBombCount,
  };
}