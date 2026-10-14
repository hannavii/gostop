import assert from 'node:assert/strict';
import { checkLayout } from './mobile-browser-checks.mjs';

export async function checkRematch({ evaluate, rpc, until, click, storage, views, sessions, mode, width }) {
  const settled = async () => {
    for (const session of sessions) await until(() => evaluate(session, `!document.querySelector('.is-animating') && !!document.querySelector('.online-game-toolbar button:not(:disabled)')`), 'actor presentation settled');
  };
  const move = async () => {
    const state = views.get(sessions[0]).game;
    const actor = sessions[state.turn];
    await settled();
    const clicked = await evaluate(actor, `(() => {
      const target = document.querySelector('.floor-cards button.selectable') || document.querySelector('button.stop-button:not(:disabled)') || document.querySelector('button.bomb-pass-button:not(:disabled)') || document.querySelector('[aria-label="\uB0B4 \uC190\uD328"] button.card');
      if (!target) return false; target.scrollIntoView({block:'nearest'}); target.click(); return true;
    })()`);
    assert.ok(clicked, 'valid action in actual round');
    // A bomb/shake offer is a UI choice, never a locally computed game action.
    await until(async () => {
      if (views.get(actor)?.game.revision > state.revision) return true;
      await evaluate(actor, `document.querySelector('.special-action-modal .special-action-normal:not(:disabled)')?.click()`);
      return false;
    }, 'actual action acknowledged');
    await until(() => sessions.every(s => views.get(s)?.game.revision > state.revision), 'all seats received action');
  };
  for (let n = 0; n < 150 && views.get(sessions[0]).game.phase !== 'finished'; n++) await move();
  assert.equal(views.get(sessions[0]).game.phase, 'finished', 'real round reaches STOP/draw');
  await settled();
  for (const session of sessions) {
    assert.ok(await evaluate(session, `!!document.querySelector('.game-over-modal .rematch-button')`));
    await checkLayout(evaluate, session, `${mode}/${width}/finished`);
  }
  const before = sessions.map(s => structuredClone(views.get(s))), credentials = await Promise.all(sessions.map(storage));
  const ids = before.map(v => ({ code: v.code, you: v.you, host: v.host, connections: v.connections.map(c => [c.seat, c.nickname, c.ready]) }));
  await click(sessions[0], '\uB2E4\uC2DC\uD558\uAE30');
  await until(() => sessions.every(s => views.get(s)?.connections[0].rematchReady), 'first consent published');
  assert.ok(sessions.every(s => views.get(s).round === before[0].round && views.get(s).game.phase === 'finished'));
  for (const session of sessions) assert.ok(await evaluate(session, `document.querySelector('.rematch-status').textContent.includes('\uB300\uAE30 \uC911')`));
  await click(sessions[0], '\uB2E4\uC2DC\uD558\uAE30 \uCDE8\uC18C');
  await until(() => sessions.every(s => !views.get(s)?.connections[0].rematchReady), 'cancel published');
  await click(sessions[0], '\uB2E4\uC2DC\uD558\uAE30');
  await until(() => sessions.every(s => views.get(s)?.connections[0].rematchReady), 'consent again');
  views.delete(sessions[0]);
  await rpc('Page.reload', { ignoreCache: true }, sessions[0]);
  await until(() => evaluate(sessions[0], `document.querySelector('.rematch-button')?.textContent === '\uB2E4\uC2DC\uD558\uAE30 \uCDE8\uC18C' && !document.querySelector('.rematch-button').disabled`), 'F5 rematch consent restored');
  await until(async () => {
    if (views.get(sessions[0])?.connections[0].connected) return true;
    await click(sessions[0], '\uC0C8\uB85C\uACE0\uCE68'); return false;
  }, 'resumed rematch snapshot');
  assert.equal(views.get(sessions[0]).you, 0);
  assert.deepEqual(views.get(sessions[0]).game, before[0].game);
  assert.deepEqual(await storage(sessions[0]), credentials[0]);
  for (let i = 1; i < sessions.length; i++) {
    await click(sessions[i], '\uB2E4\uC2DC\uD558\uAE30');
    if (i < sessions.length - 1) {
      await until(() => sessions.every(s => views.get(s)?.connections[i].rematchReady), 'third seat still required');
      assert.ok(sessions.every(s => views.get(s).game.phase === 'finished'));
    }
  }
  await until(() => sessions.every(s => views.get(s)?.round === before[0].round + 1), 'same room new match');
  for (let i = 0; i < sessions.length; i++) {
    const v = views.get(sessions[i]);
    assert.deepEqual({ code: v.code, you: v.you, host: v.host, connections: v.connections.map(c => [c.seat, c.nickname, c.ready]) }, ids[i]);
    assert.deepEqual(await storage(sessions[i]), credentials[i]);
    assert.equal(v.game.phase, 'play'); assert.equal(v.game.turn, 0); assert.equal(v.game.result, null); assert.equal(v.game.choice, null);
    assert.ok(v.connections.every(c => !c.rematchReady));
    assert.deepEqual(v.game.revealed, []); assert.deepEqual(v.game.ppeokStacks, []);
    assert.ok(v.game.players.every(p => !p.captured.length && !p.score && !p.goCount && !p.bombCount && !p.bombPassCount && !p.shakeMonths.length));
    assert.equal(v.game.hand.length, mode === 'gostop' ? 7 : 10);
    await until(() => evaluate(sessions[i], `!document.querySelector('.game-over-modal, .animation-layer, .capture-flight-layer, .special-action-modal, .capture-zoom-panel, .is-animating') && document.querySelectorAll('.player-area .card').length === ${v.game.hand.length}`), 'old presentation reset before new play');
    await checkLayout(evaluate, sessions[i], `${mode}/${width}/rematch`);
    for (let j = 0; j < sessions.length; j++) if (j !== i) for (const card of views.get(sessions[j]).game.hand) assert.ok(!JSON.stringify(v).includes(`"${card.id}"`));
  }
  await move(); await settled();
  console.log(`PASS ${mode}/${width}: real finished round -> consent/cancel -> F5 preserves consent/token -> ${sessions.length} unanimous votes -> same room/identity/host -> fresh deal, no stale presentation/private leak -> real new hand play.`);
}
