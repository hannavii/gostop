import type { SettlementResult } from '../game/settlement';

type Details = Pick<SettlementResult, 'scoreItems' | 'sakeCupAsPi' | 'baseScore' | 'goBonus' | 'scoreBeforeMultipliers' | 'winnerGoCount'>;

// All values are supplied by the authoritative settlement. No card counting or rules here.
export default function SettlementScoreDetails({ settlement }: { settlement: Details }) {
  return <section className="online-score-details" aria-label="기본 점수 구성" data-testid="score-breakdown">
    <h3>기본 점수 구성</h3>
    <dl>
      {settlement.scoreItems?.map(item => <div key={item.id} data-testid={`score-item-${item.id}`}>
        <dt>{item.label}</dt><dd>+{item.points}점</dd>
      </div>)}
      {settlement.scoreItems?.length === 0 && <div><dt>득점 항목 없음</dt><dd>0점</dd></div>}
      <div className="online-score-subtotal"><dt>기본 점수</dt><dd>{settlement.baseScore}점</dd></div>
      {settlement.goBonus > 0 && <div><dt>{settlement.winnerGoCount}고 추가 점수</dt><dd>+{settlement.goBonus}점</dd></div>}
      <div><dt>배수 적용 전 점수</dt><dd>{settlement.scoreBeforeMultipliers}점</dd></div>
    </dl>
    {settlement.sakeCupAsPi && <p>술잔은 쌍피로 계산되었습니다.</p>}
  </section>;
}
