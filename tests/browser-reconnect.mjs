// Optional real-browser regression: npm run test:browser-reconnect.
// Uses installed Chromium/Edge via CDP, without a browser automation dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { createOnlineServer } from '../server/app.ts';

const executable = process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const artifactRoot = resolve('.tmp-online.local');
await mkdir(artifactRoot, { recursive: true });
const profile = await mkdtemp(resolve(artifactRoot, 'reconnect-browser-'));
const server = createOnlineServer();
server.http.listen(0, '127.0.0.1');
await once(server.http, 'listening');
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: {
  '/socket.io': { target: `http://127.0.0.1:${server.http.address().port}`, ws: true },
} }, logLevel: 'error' });
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser, ws, rpc;
async function until(work, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await work();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}
try {
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const port = await until(async () => {
    if (launchError) throw launchError;
    try { return (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; }
  }, 'browser startup');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), views = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.webSocketFrameReceived') {
      const payload = message.params.response.payloadData;
      if (payload.startsWith('42')) {
        const [event, value] = JSON.parse(payload.slice(2));
        if (event === 'room:state') views.set(message.sessionId, value);
      }
    }
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id);
      pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
    }
  };
  rpc = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const request = ++id;
    const timer = setTimeout(() => { pending.delete(request); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(request, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: request, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (session, expression) => {
    const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click = (session, label) => evaluate(session,
    `[...document.querySelectorAll('button:not(:disabled)')].find(b=>b.textContent===${JSON.stringify(label)})?.click()`);
  const ready = session => until(() => evaluate(session, `!!document.querySelector('#online-mode:not(:disabled)')`), 'connected lobby');
  const storage = session => evaluate(session, `JSON.parse(sessionStorage.getItem('gostop.online.reconnect'))`);

  for (const mode of ['matgo', 'gostop']) {
    const count = mode === 'gostop' ? 3 : 2;
    const contexts = [], sessions = [];
    for (let i = 0; i < count; i++) {
      const { browserContextId } = await rpc('Target.createBrowserContext'); contexts.push(browserContextId);
      const { targetId } = await rpc('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true }); sessions.push(sessionId);
      await rpc('Runtime.enable', {}, sessionId);
      await rpc('Network.enable', {}, sessionId);
      await rpc('Page.enable', {}, sessionId);
      await rpc('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await rpc('Page.navigate', { url }, sessionId);
      await until(() => evaluate(sessionId, `!!document.querySelector('.online-mode-entry')`), 'mode entry');
      await evaluate(sessionId, `document.querySelector('.online-mode-entry').click()`);
      await ready(sessionId);
      await evaluate(sessionId, `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('#online-nickname'),${JSON.stringify('친구' + i)});document.querySelector('#online-nickname').dispatchEvent(new Event('input',{bubbles:true}))`);
    }
    await evaluate(sessions[0], `document.querySelector('#online-mode').value=${JSON.stringify(mode)};document.querySelector('#online-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
    await click(sessions[0], '방 만들기');
    const code = await until(() => evaluate(sessions[0], `document.querySelector('.online-code')?.textContent`), 'room code');
    for (let i = 1; i < count; i++) {
      await evaluate(sessions[i], `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('#online-room-code'),${JSON.stringify(code)});document.querySelector('#online-room-code').dispatchEvent(new Event('input',{bubbles:true}))`);
      await evaluate(sessions[i], `document.querySelector('form').requestSubmit()`);
    }
    for (const session of sessions) {
      await until(() => evaluate(session, `!!document.querySelector('.online-waiting-room')`), 'waiting room');
      assert.equal(await evaluate(session, `!!document.querySelector('.online-game-toolbar')`), false);
    }
    assert.equal(await evaluate(sessions[0], `document.querySelector('.online-start').disabled`), true);
    await click(sessions[0], '방 코드 복사');
    await until(() => evaluate(sessions[0], `document.querySelector('.online-room-code [role="status"]')?.textContent.includes('복사')`), 'copy feedback');
    await evaluate(sessions[0], `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } })`);
    await click(sessions[0], '방 코드 복사');
    await until(() => evaluate(sessions[0], `document.querySelector('.online-room-code [role="status"]')?.textContent.includes('직접 선택')`), 'clipboard failure fallback');
    assert.equal(await evaluate(sessions[0], `document.querySelector('.online-code').textContent`), code);
    for (const session of sessions) await click(session, '준비');
    await until(() => evaluate(sessions[0], `!document.querySelector('.online-start').disabled`), 'all ready');
    await click(sessions[1], '준비 취소');
    await until(() => evaluate(sessions[0], `document.querySelector('.online-start').disabled`), 'cancel ready synchronized');
    await click(sessions[1], '준비');
    // F5 in lobby retains name, readiness and host, without dealing cards.
    await rpc('Page.reload', { ignoreCache: true }, sessions[0]);
    await until(() => evaluate(sessions[0], `document.querySelector('.online-start')?.disabled === false`), 'lobby F5 readiness recovery');
    assert.ok(await evaluate(sessions[0], `document.querySelector('.online-players').textContent.includes('친구0')`));
    await click(sessions[0], '게임 시작');
    for (const session of sessions) {
      await until(() => evaluate(session, `!!document.querySelector('.online-game-toolbar')`), 'game start');
      // Also obtains a snapshot if initial room events used HTTP polling.
      await click(session, '새로고침');
      await until(() => !!views.get(session)?.game, 'WebSocket snapshot');
    }
    // Make one actual hand play before reloading, preserving any pending choice.
    await evaluate(sessions[0], `document.querySelector('[aria-label="내 손패"] button.card').click()`);
    await delay(150);
    await evaluate(sessions[0], `[...document.querySelectorAll('button')].find(b=>b.textContent==='그냥 한 장 내기')?.click()`);
    await until(() => sessions.every(s => views.get(s)?.game?.revision > 0), 'first action');

    for (let seat = 0; seat < count; seat++) {
      const session = sessions[seat];
      const before = structuredClone(views.get(session));
      const credentials = await storage(session);
      assert.deepEqual(Object.keys(credentials).sort(), ['roomCode', 'token']);
      views.delete(session);
      await rpc('Page.reload', { ignoreCache: true }, session);
      // No click on the mode entry: App must resume automatically after F5.
      await until(() => evaluate(session, `!!document.querySelector('.online-game-toolbar')`), 'automatic F5 recovery');
      await until(() => evaluate(session, `!!document.querySelector('.online-game-toolbar button:not(:disabled)')`), 'resume complete');
      // Resume may arrive over initial HTTP polling before WebSocket upgrade.
      await until(async () => {
        if (views.get(session)?.connections[seat].connected) return true;
        await click(session, '새로고침');
        return false;
      }, 'recovered WebSocket snapshot');
      const recovered = views.get(session);
      assert.equal(recovered.you, seat);
      assert.equal(recovered.code, code);
      assert.deepEqual(recovered.game, before.game);
      assert.deepEqual(recovered.connections.map(p => [p.nickname, p.ready]), before.connections.map(p => [p.nickname, p.ready]));
      assert.equal(recovered.host, before.host);
      assert.deepEqual(await storage(session), credentials);
      for (let other = 0; other < count; other++) if (other !== seat) {
        const publicWire = JSON.stringify(recovered);
        for (const card of views.get(sessions[other]).game.hand) assert.ok(!publicWire.includes(`"${card.id}"`));
        assert.ok(!publicWire.includes((await storage(sessions[other])).token));
      }
    }
    // Drop transports without a namespace disconnect: Socket.IO should reconnect
    // automatically, then the app must authenticate and recover the same seats.
    const beforeDrop = sessions.map(session => structuredClone(views.get(session)));
    for (const session of sessions) views.delete(session);
    for (const socket of server.io.sockets.sockets.values()) socket.conn.close();
    await until(() => sessions.every(s => views.get(s)?.connections.every(c => c.connected)), 'automatic network recovery');
    for (let i = 0; i < count; i++) {
      assert.equal(views.get(sessions[i]).you, i);
      assert.deepEqual(views.get(sessions[i]).game, beforeDrop[i].game);
    }
    // Continue the actual current actor's pending choice / GO / play after F5.
    const state = views.get(sessions[0]).game;
    const actor = sessions[state.turn];
    await until(() => evaluate(actor, `!document.querySelector('.is-animating') && !!document.querySelector('.online-game-toolbar button:not(:disabled)')`), 'actor ready');
    const acted = await evaluate(actor, `(() => {
      const target=document.querySelector('.floor-cards button.selectable') || document.querySelector('button.go-button:not(:disabled)') || document.querySelector('button.bomb-pass-button:not(:disabled)') || document.querySelector('[aria-label="내 손패"] button.card');
      if(!target)return false;target.click();return true;
    })()`);
    assert.ok(acted, 'valid action after reload');
    await delay(150);
    await evaluate(actor, `[...document.querySelectorAll('button')].find(b=>b.textContent==='그냥 한 장 내기')?.click()`);
    await until(() => sessions.every(s => views.get(s)?.game?.revision > state.revision), 'continued game synchronized');
    // Explicit leave clears saved credentials in every connected participant.
    await until(() => evaluate(sessions[0], `!!document.querySelector('.online-game-toolbar button:not(:disabled)')`), 'leave enabled');
    await click(sessions[0], '방 나가기');
    for (const session of sessions) await until(async () => (await storage(session)) === null, 'credentials cleared on leave');
    console.log(`PASS ${mode}: ${count} independent browser contexts, nickname → lobby → copy → ready/cancel → lobby F5 → host start; all seats F5 + transport drop → exact private state → continued game; tokens cleared on leave.`);
    for (const browserContextId of contexts) await rpc('Target.disposeBrowserContext', { browserContextId });
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS: no browser JavaScript exceptions.');
} finally {
  if (rpc && ws?.readyState === WebSocket.OPEN) {
    await rpc('Browser.close').catch(() => {});
  }
  ws?.close();
  if (browser && browser.exitCode === null) {
    browser.kill();
    await Promise.race([once(browser, 'exit').catch(() => {}), delay(2000)]);
  }
  await vite.close();
  await new Promise(resolve => server.io.close(resolve));
  // Delete only the freshly generated profile under the dedicated ignored directory.
  if (!resolve(profile).startsWith(artifactRoot + sep)) throw new Error('Invalid temporary profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
