/* eslint-disable react-refresh/only-export-components -- Browser-only fixture exposes a mount helper. */
// Browser-only presentation fixture. No Room, game engine or private state injection.
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CapturedPanel from '../src/components/CapturedPanel';
import { CapturedPanel as GostopCapturedPanel } from '../src/GostopGame';
import CapturedCardsModal from '../src/components/CapturedCardsModal';
import MatgoTable from '../src/components/MatgoTable';
import Card from '../src/components/Card';
import { useAiLayoutAnchors } from '../src/components/useAiLayoutAnchors';
import { hwatuCards } from '../src/data/cards';
import { calculateScore } from '../src/game/scoring';
import type { GameMode } from '../src/game/rules';
import '../src/App.css';

type Prompt = 'none' | 'choose' | 'special' | 'go-stop' | 'finished';
type Options = { mode: GameMode; crowded: boolean; prompt?: Prompt };
let root: Root | undefined;
let generation = 0;

function Layout({ mode, crowded, prompt = 'none' }: Options) {
  const [detail, setDetail] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const three = mode === 'gostop';
  const boardRef = useAiLayoutAnchors(true);
  // Deliberately more crowded than a normal single owner can accumulate.
  // Every category, many pi and all badge rows must remain reachable.
  const captured = crowded ? hwatuCards : [];
  const score = calculateScore(captured);
  const panels = three ? ['상대 1 먹은 패', '상대 2 먹은 패', '내 먹은 패'] : ['상대 먹은 패', '내 먹은 패'];
  const hand = hwatuCards.slice(0, three ? 7 : 10);
  const floor = hwatuCards.slice(12, 18);
  return <>
    <button className={`mode-back-button${three ? ' mode-back-button--gostop-game' : ''}`} onClick={() => setAction('back')}>← 게임 선택</button>
    <main ref={boardRef} className={`game ai-game ai-game--${mode}${three ? ' gostop3-game' : ''}`} data-started="true">
      <button className={three ? 'gostop3-restart-button' : 'start-button'} onClick={() => setAction('restart')}>다시 시작</button>
      {three && <div className="turn-message">내 차례입니다. 카드를 한 장 선택하세요.</div>}
      {panels.map((title, index) => {
        const common = { title, cards: captured, score, goCount: crowded ? 3 : 0, shakeCount: crowded ? 2 : 0,
          shakeMonths: crowded ? [1, 3] : [], bombCount: crowded ? 2 : 0, onOpenDetails: () => setDetail(title) };
        return three
          ? <GostopCapturedPanel key={title} {...common} position={index === 0 ? 'opponent1' : index === 1 ? 'opponent2' : 'player'} />
          : <CapturedPanel key={title} {...common} side={index === 0 ? 'left' : 'right'} />;
      })}
      <section className={three ? 'gostop3-opponents-area' : 'opponent-area'}>
        {Array.from({ length: three ? 2 : 1 }, (_, index) => <div key={index} className={three ? 'gostop3-opponent-zone' : undefined} style={{ width: '100%', minWidth: 0 }}>
          <h2>상대 {index + 1}</h2>
          <div className={`card-row${three ? ' gostop3-opponent-hand' : ''}`}>{hand.map(card => <Card key={card.id} isBack />)}</div>
          <p>손패 {hand.length}장 · 점수 0점 · GO 0회</p>
        </div>)}
      </section>
      <MatgoTable className={three ? 'gostop3-table' : undefined} floorCards={floor} ppeokStacks={[]}
        expandedPpeokMonth={null} setExpandedPpeokMonth={() => {}} pendingChoice={prompt === 'choose' ? { matchingCards: floor.slice(0, 2) } : null}
        turnMessage={three ? '' : '내 차례입니다. 카드를 한 장 선택하세요.'} isAnimating={false} gameOver={false}
        gameStarted drawCount={21} handleFloorCardChoice={() => setAction('choose')} />
      <section className={`player-area${three ? ' gostop3-player-area' : ''}`}>
        <h2>내 패 ◀</h2><div className={`card-row${three ? ' gostop3-player-hand' : ''}`}>{hand.map(card => <Card key={card.id} card={card} onClick={() => setAction(card.id)} />)}</div>
        <p>손패 {hand.length}장 · 점수 0점 · GO 0회</p>
      </section>
      {detail && <CapturedCardsModal title={detail} cards={captured} totalScore={score.total} goCount={3} shakeMonths={[1, 3]} bombCount={2} onClose={() => setDetail(null)} />}
      {prompt === 'go-stop' && <div className="go-stop-overlay"><div className="go-stop-modal" role="dialog" aria-label="GO STOP">
        <h2>GO / STOP</h2><button className="go-button" onClick={() => setAction('go')}>GO</button><button className="stop-button" onClick={() => setAction('stop')}>STOP</button>
      </div></div>}
      {prompt === 'special' && <div className="special-action-overlay"><div className="special-action-modal" role="dialog" aria-label="특수 행동 선택">
        <h2>폭탄 / 흔들기</h2><button className="special-action-confirm" onClick={() => setAction('bomb')}>폭탄 사용</button><button onClick={() => setAction('shake')}>흔들기</button>
      </div></div>}
      {prompt === 'finished' && <div className="game-over-overlay"><div className="game-over-modal" role="dialog" aria-label="게임 결과">
        <h2>게임 종료</h2><button className="restart-game-button" onClick={() => setAction('restart')}>새 게임</button>
      </div></div>}
    </main><output data-testid="layout-action" style={{ position: 'fixed', left: 0, bottom: 0, pointerEvents: 'none' }}>{action}</output>
  </>;
}

export function mountAiCapturedLayout(options: Options) {
  let container = document.getElementById('ai-layout-fixture');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ai-layout-fixture';
    document.body.append(container);
    document.getElementById('root')!.style.display = 'none';
    root = createRoot(container);
  }
  root!.render(<Layout key={++generation} {...options} />);
}
