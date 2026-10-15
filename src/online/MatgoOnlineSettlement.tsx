import type { SettlementResult } from '../game/settlement';
import SettlementScoreDetails from './SettlementScoreDetails';

export default function MatgoOnlineSettlement({ settlement, winner, loser }: {
  settlement: SettlementResult; winner: string; loser: string;
}) {
  return <section className="settlement-board online-settlement-detail" aria-label="맞고 상세 정산">
    <div className="settlement-total" data-testid="settlement-total"><span>최종 정산 점수</span><strong>{settlement.finalScore}점</strong></div>
    <p>승자: {winner} · 패자: {loser}</p>
    <SettlementScoreDetails settlement={settlement} />
    {settlement.multipliers.length > 0 && <section aria-label="적용된 배수와 박">
      <h3>적용된 배수와 박</h3>
      <div className="settlement-multipliers">{settlement.multipliers.map(item => <div key={item.id} className="settlement-multiplier">
        <span>{item.label}</span><strong>×{item.multiplier}</strong>
      </div>)}</div>
    </section>}
    <p className="online-settlement-formula">{settlement.scoreBeforeMultipliers}점 × {settlement.totalMultiplier} = {settlement.finalScore}점</p>
    <p>{loser} 부담 · {settlement.finalScore}점 → {winner}</p>
  </section>;
}
