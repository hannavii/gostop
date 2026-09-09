import { calculateScore } from "./scoring";
import type { HwatuCard } from "../types/game";

export type GostopPlayerIndex = 0 | 1 | 2;

export type GostopSettlementMultiplier = {
  id: "go" | "shake-bomb" | "meong-bak";
  label: string;
  multiplier: number;
};

export type GostopSettlementPlayer = {
  index: GostopPlayerIndex;
  cards: HwatuCard[];
  goCount: number;
  shakeCount: number;
  bombCount: number;
};

export type GostopLoserSettlement = {
  loser: GostopPlayerIndex;

  normalPayment: number;
  payment: number;
  totalMultiplier: number;

  gwangBak: boolean;
  piBak: boolean;
  goBak: boolean;

  /*
   * 고박으로 다른 패자의 몫까지 대신 냈다면
   * 그 플레이어 번호를 저장합니다.
   */
  goBakPaidFor: GostopPlayerIndex | null;
};

export type GostopSettlementResult = {
  winner: GostopPlayerIndex;

  baseScore: number;
  goBonus: number;
  scoreBeforeMultipliers: number;

  winnerGoCount: number;
  winnerShakeCount: number;
  winnerBombCount: number;

  winnerMultipliers: GostopSettlementMultiplier[];
  winnerMultiplier: number;

  loserSettlements: GostopLoserSettlement[];

  /* 실제로 고박 대납을 하는 패자 */
  goBakPayer: GostopPlayerIndex | null;

  /* 두 패자가 최종적으로 지불하는 값의 합 */
  totalReceived: number;
};

export type CalculateGostopSettlementInput = {
  winner: GostopPlayerIndex;
  players: GostopSettlementPlayer[];
};

/*
 * 3인 고스톱 프로젝트용 피박 기준.
 * 유효 피가 6장 미만이면 피박으로 처리합니다.
 * 서비스/집룰에 따라 이 숫자만 바꾸면 됩니다.
 */
const GOSTOP_PI_BAK_SAFE_COUNT = 6;

function productMultipliers(
  multipliers: GostopSettlementMultiplier[]
) {
  return multipliers.reduce(
    (total, item) => total * item.multiplier,
    1
  );
}

export function calculateGostopSettlement({
  winner,
  players,
}: CalculateGostopSettlementInput): GostopSettlementResult {
  const winnerPlayer = players.find(
    (player) => player.index === winner
  );

  if (!winnerPlayer) {
    throw new Error("승자 정보를 찾을 수 없습니다.");
  }

  const loserPlayers = players.filter(
    (player) => player.index !== winner
  );

  if (loserPlayers.length !== 2) {
    throw new Error("3인 고스톱 정산에는 패자가 2명이어야 합니다.");
  }

  const winnerScore = calculateScore(winnerPlayer.cards);

  const baseScore = winnerScore.total;

  /*
   * 현재 프로젝트의 GO 계산은 2인 맞고와 동일하게 유지합니다.
   * 1고 +1, 2고 +2, 3고부터는 아래에서 추가 배수 적용.
   */
  const goBonus = Math.min(winnerPlayer.goCount, 2);
  const scoreBeforeMultipliers = baseScore + goBonus;

  const winnerMultipliers: GostopSettlementMultiplier[] = [];

  if (winnerPlayer.goCount >= 3) {
    winnerMultipliers.push({
      id: "go",
      label: `${winnerPlayer.goCount}고`,
      multiplier: 2 ** (winnerPlayer.goCount - 2),
    });
  }

  /* 흔들기와 폭탄은 선언 1회마다 승리 시 x2 */
  const shakeBombCount =
    winnerPlayer.shakeCount + winnerPlayer.bombCount;

  if (shakeBombCount > 0) {
    const labels: string[] = [];

    if (winnerPlayer.shakeCount > 0) {
      labels.push(`흔들기 ${winnerPlayer.shakeCount}회`);
    }

    if (winnerPlayer.bombCount > 0) {
      labels.push(`폭탄 ${winnerPlayer.bombCount}회`);
    }

    winnerMultipliers.push({
      id: "shake-bomb",
      label: labels.join(" · "),
      multiplier: 2 ** shakeBombCount,
    });
  }

  /* 열끗 7장 이상이면 멍박/멍따 x2 */
  if (winnerScore.animalCount >= 7) {
    winnerMultipliers.push({
      id: "meong-bak",
      label: "멍박",
      multiplier: 2,
    });
  }

  const winnerMultiplier = productMultipliers(winnerMultipliers);

  let loserSettlements: GostopLoserSettlement[] = loserPlayers.map(
    (loserPlayer) => {
      const loserScore = calculateScore(loserPlayer.cards);

      const gwangBak =
        winnerScore.gwangScore > 0 && loserScore.gwangCount === 0;

      const piBak =
        winnerScore.piScore > 0 &&
        loserScore.piCount < GOSTOP_PI_BAK_SAFE_COUNT;

      let loserMultiplier = 1;

      if (gwangBak) loserMultiplier *= 2;
      if (piBak) loserMultiplier *= 2;

      const totalMultiplier = winnerMultiplier * loserMultiplier;
      const normalPayment = scoreBeforeMultipliers * totalMultiplier;

      return {
        loser: loserPlayer.index,
        normalPayment,
        payment: normalPayment,
        totalMultiplier,
        gwangBak,
        piBak,
        goBak: false,
        goBakPaidFor: null,
      };
    }
  );

  /*
   * 3인 고박:
   * 패자 중 한 명이 GO를 한 뒤 다른 사람이 STOP하면,
   * 그 GO 패자가 다른 패자의 정산까지 대신 부담합니다.
   *
   * 현재 상태에는 "누가 마지막으로 GO했는지" 순서 정보가 없어서
   * 패자 두 명이 모두 GO한 드문 경우에는 대납을 적용하지 않습니다.
   * 나중에 GO 선언 순서를 저장하면 이 부분을 더 정확히 확장할 수 있습니다.
   */
  const goBakCandidates = loserPlayers.filter(
    (player) => player.goCount > 0
  );

  let goBakPayer: GostopPlayerIndex | null = null;

  if (goBakCandidates.length === 1) {
    goBakPayer = goBakCandidates[0].index;

    const payerIndex = loserSettlements.findIndex(
      (item) => item.loser === goBakPayer
    );

    const otherIndex = loserSettlements.findIndex(
      (item) => item.loser !== goBakPayer
    );

    if (payerIndex >= 0 && otherIndex >= 0) {
      const payer = loserSettlements[payerIndex];
      const other = loserSettlements[otherIndex];

      loserSettlements = loserSettlements.map((item, index) => {
        if (index === payerIndex) {
          return {
            ...item,
            payment: payer.normalPayment + other.normalPayment,
            goBak: true,
            goBakPaidFor: other.loser,
          };
        }

        if (index === otherIndex) {
          return {
            ...item,
            payment: 0,
          };
        }

        return item;
      });
    }
  }

  const totalReceived = loserSettlements.reduce(
    (total, item) => total + item.payment,
    0
  );

  return {
    winner,
    baseScore,
    goBonus,
    scoreBeforeMultipliers,
    winnerGoCount: winnerPlayer.goCount,
    winnerShakeCount: winnerPlayer.shakeCount,
    winnerBombCount: winnerPlayer.bombCount,
    winnerMultipliers,
    winnerMultiplier,
    loserSettlements,
    goBakPayer,
    totalReceived,
  };
}
