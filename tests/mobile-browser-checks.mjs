import assert from 'node:assert/strict';
import { createMatch, gameView } from '../server/game.ts';
import { hwatuCards } from '../src/data/cards.ts';
import { calculateGostopSettlement } from '../src/game/gostopSettlement.ts';
import { calculateSettlement } from '../src/game/settlement.ts';

export async function checkLayout(evaluate, session, label) {
  const result = await evaluate(session, `(() => {
    const visible = e => e.getClientRects().length && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
    const selectors = '.game, .online-page, .online-lobby, .card-row, .captured-panel, .floor-cards, .go-stop-modal, .special-action-modal, .game-over-modal, .capture-zoom-panel, .ppeok-stack-label, .ppeok-stack-detail';
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll(selectors)].filter(visible).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => [e.className, e.scrollWidth, e.clientWidth]),
      modalOutside: [...document.querySelectorAll('.go-stop-modal, .special-action-modal, .game-over-modal, .capture-zoom-panel, .ppeok-stack-detail')].filter(visible).filter(e => {
        const r=e.getBoundingClientRect(); return r.top < -1 || r.bottom > innerHeight + 1;
      }).map(e => e.className),
      outside: [...document.querySelectorAll(selectors + ', button, input, select')].filter(visible).filter(e => {
        const r=e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
      }).map(e => [e.className, e.textContent?.slice(0,40)]) };
  })()`);
  assert.ok(result.documentWidth <= result.width + 1, `${label}: body overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${label}: internal horizontal overflow`);
  assert.deepEqual(result.outside, [], `${label}: outside viewport`);
  assert.deepEqual(result.modalOutside, [], `${label}: modal clipped vertically`);
}

export async function checkMobileStates({ evaluate, rpc, until, session, mode, width, height }) {
  const snapshot = gameView(createMatch(mode), 0);
  // Deliberately crowded public display fixture; no gameplay or server mutation.
  snapshot.hand = hwatuCards.slice(0, mode === 'matgo' ? 10 : 7);
  snapshot.floor = hwatuCards.slice(12, 27);
  snapshot.ppeokStacks = [{ month: snapshot.floor[0].month, owner: 1 }];
  snapshot.canPlayHand = true;
  snapshot.players[0].captured = hwatuCards.slice(28);
  snapshot.players[0].score = 21;
  snapshot.players[0].goCount = 3;
  snapshot.players[0].shakeMonths = [1, 2, 3];
  snapshot.players[0].bombCount = 2;
  const mount = async (game, selector) => {
    const generation = await evaluate(session, `import('/tests/online-layout-fixture.tsx').then(m => m.mountLayoutFixture(${JSON.stringify(game)}))`);
    await until(() => evaluate(session, `!!document.querySelector('#layout-fixture [data-layout-generation="${generation}"] ${selector}')`), `fixture ${selector}`);
    await checkLayout(evaluate, session, `${mode}/${width}/${selector}`);
  };
  const press = async selector => {
    const point = await evaluate(session, `(() => {
      const e = document.querySelector('#layout-fixture :is(${selector})'); e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2;
      return {x,y,hit:e.contains(document.elementFromPoint(x,y))};
    })()`);
    assert.ok(point.hit, `${selector} must be touch reachable`);
    await evaluate(session, 'window.layoutAction = null');
    await rpc('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] }, session);
    await rpc('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session);
  };
  const expectAction = type => until(() => evaluate(session, `window.layoutAction?.type === ${JSON.stringify(type)}`), `touch action ${type}`);
  await mount(snapshot, '.player-area button.card');
  await press('.player-area button.card');
  await expectAction('play');
  await press('.ppeok-stack-slot');
  await until(() => evaluate(session, `!!document.querySelector('#layout-fixture .ppeok-stack-slot.is-open')`), 'touch ppeok expanded');
  await checkLayout(evaluate, session, 'ppeok expanded');
  await press('.ppeok-stack-slot');
  await mount({ ...snapshot, hand: [], floor: [], ppeokStacks: [], players: snapshot.players.map(p => ({ ...p, captured: p.seat === 0 ? hwatuCards : [] })) }, '.captured-panel');
  // A shorter visual viewport also covers browser chrome / landscape-like heights.
  await rpc('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: true }, session);
  await evaluate(session, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await press('.captured-panel--right, .gostop3-captured-panel--player');
  await until(() => evaluate(session, `!!document.querySelector('#layout-fixture .capture-zoom-panel')`), 'captured modal open');
  await checkLayout(evaluate, session, 'captured many cards');
  const modal = await evaluate(session, `(() => { const e=document.querySelector('#layout-fixture .capture-zoom-panel'); const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:innerHeight,scrollable:e.scrollHeight>e.clientHeight}; })()`);
  assert.ok(modal.top >= 0 && modal.bottom <= modal.height + 1, 'captured modal fits viewport');
  if (width < 700) assert.ok(modal.scrollable, 'crowded captured modal scrolls vertically');
  await press('.capture-zoom-close');
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }, session);
  await evaluate(session, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

  for (const type of ['shake', 'bomb']) {
    await mount({ ...snapshot, specialOptions: [{ cardId: snapshot.hand[0].id, type }] }, '.player-area button.card');
    await press('.player-area button.card');
    await until(() => evaluate(session, `!!document.querySelector('#layout-fixture .special-action-modal')`), `${type} prompt`);
    await checkLayout(evaluate, session, `${type} prompt`);
    await press('.special-action-normal');
    await expectAction('play');
  }
  await mount({ ...snapshot, phase: 'choose', choice: snapshot.floor.slice(3, 5), specialOptions: [] }, '.floor-cards button.selectable');
  await press('.floor-cards button.selectable');
  await expectAction('choose');
  await mount({ ...snapshot, phase: 'go-stop', specialOptions: [] }, '.go-stop-modal');
  for (const type of ['go', 'stop']) {
    await press(`.${type}-button`);
    await expectAction(type);
  }
  const result = mode === 'gostop'
    ? { winner: 0, settlement: null, gostopSettlement: calculateGostopSettlement({ winner: 0, players: snapshot.players.map(p => ({ index: p.seat, cards: p.captured, goCount: p.goCount, shakeCount: p.shakeMonths.length, bombCount: p.bombCount })) }) }
    : { winner: 0, settlement: calculateSettlement(snapshot.players[0].captured, snapshot.players[1].captured, 3, 1, 3, 2) };
  await mount({ ...snapshot, phase: 'finished', result, specialOptions: [] }, '.game-over-modal');
  await press('.restart-game-button');
  await checkLayout(evaluate, session, 'result scrolled to leave button');
  await evaluate(session, `import('/tests/online-layout-fixture.tsx').then(m => m.unmountLayoutFixture())`);
  console.log(`PASS ${mode}/${width}: crowded floor + ppeok touch, hand touch, captured scroll/close, shake/bomb/normal, match choice, GO/STOP, settlement/leave.`);
}
