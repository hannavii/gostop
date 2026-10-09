import type { GostopSettlementResult } from "../game/gostopSettlement";
import type { Seat } from "../../shared/online";

// Same presentation classes as the single-player three-seat settlement screen.
export default function GostopOnlineSettlement({ settlement, name }: {
  settlement: GostopSettlementResult; name: (seat: Seat) => string;
}) {
  return <div className="gostop3-settlement-panel">
    <div className="gostop3-settlement-heading">
      <div><span>최종 정산</span><strong>{settlement.scoreBeforeMultipliers}점 기준</strong></div>
      <div className="gostop3-settlement-total"><span>총 획득</span><strong>{settlement.totalReceived}점</strong></div>
    </div>
    <div className="gostop3-settlement-formula">
      <span>기본 {settlement.baseScore}점</span><span>GO 보너스 +{settlement.goBonus}</span>
      {settlement.winnerMultipliers.map(item => <span key={item.id}>{item.label} ×{item.multiplier}</span>)}
    </div>
    <div className="gostop3-settlement-losers">
      {settlement.loserSettlements.map(loser => <div key={loser.loser} className={`gostop3-settlement-loser ${loser.goBak ? "is-go-bak" : ""}`}>
        <div className="gostop3-settlement-loser-name"><strong>{name(loser.loser)}</strong>
          <span>{loser.payment === 0 ? "고박 대납" : `${loser.payment}점 지불`}</span></div>
        <div className="gostop3-settlement-tags">
          {loser.gwangBak && <span>광박 ×2</span>}{loser.piBak && <span>피박 ×2</span>}{loser.goBak && <span>고박</span>}
          {!loser.gwangBak && !loser.piBak && !loser.goBak && <span>추가 박 없음</span>}
        </div>
        {loser.goBakPaidFor !== null && <small>{name(loser.goBakPaidFor)}의 정산까지 대신 부담합니다.</small>}
      </div>)}
    </div>
    {settlement.goBakPayer !== null && <p className="gostop3-settlement-note">{name(settlement.goBakPayer)} 고박: 다른 패자의 정산까지 대신 부담했습니다.</p>}
  </div>;
}
