import type { GostopSettlementResult } from "../game/gostopSettlement";
import type { Seat } from "../../shared/online";
import SettlementScoreDetails from './SettlementScoreDetails';

// Same presentation classes as the single-player three-seat settlement screen.
export default function GostopOnlineSettlement({ settlement, name }: {
  settlement: GostopSettlementResult; name: (seat: Seat) => string;
}) {
  return <div className="gostop3-settlement-panel online-settlement-detail" aria-label="고스톱 상세 정산">
    <div className="gostop3-settlement-heading">
      <div><span>승자</span><strong>{name(settlement.winner)}</strong></div>
      <div className="gostop3-settlement-total" data-testid="settlement-total"><span>총 획득</span><strong>{settlement.totalReceived}점</strong></div>
    </div>
    <SettlementScoreDetails settlement={settlement} />
    {settlement.winnerMultipliers.length > 0 && <h3>승자 적용 배수</h3>}
    <div className="gostop3-settlement-formula">
      {settlement.winnerMultipliers.map(item => <span key={item.id}>{item.label} ×{item.multiplier}</span>)}
    </div>
    <h3>패자별 부담</h3>
    <div className="gostop3-settlement-losers">
      {settlement.loserSettlements.map(loser => <div key={loser.loser} data-testid={`payer-${loser.loser}`} className={`gostop3-settlement-loser ${loser.goBak ? "is-go-bak" : ""}`}>
        <div className="gostop3-settlement-loser-name"><strong>{name(loser.loser)}</strong>
          <span>{settlement.goBakPayer !== null && loser.loser !== settlement.goBakPayer ? "고박 대납 · " : ""}{loser.payment}점 부담</span></div>
        <small>대납 전 {loser.normalPayment}점 · 배수 적용 전 {settlement.scoreBeforeMultipliers}점 × 총 {loser.totalMultiplier}배</small>
        <div className="gostop3-settlement-tags">
          {loser.gwangBak && <span>광박 ×2</span>}{loser.piBak && <span>피박 ×2</span>}{loser.goBak && <span>고박</span>}
        </div>
        {loser.goBakPaidFor !== null && <small>{name(loser.goBakPaidFor)}의 정산까지 대신 부담합니다.</small>}
      </div>)}
    </div>
    {settlement.goBakPayer !== null && <p className="gostop3-settlement-note">{name(settlement.goBakPayer)} 고박: 다른 패자의 정산까지 대신 부담했습니다.</p>}
  </div>;
}
