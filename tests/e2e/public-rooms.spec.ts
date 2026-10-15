import { test, expect, noOverflow, playTurn, startRoom, type Peer } from './fixtures';

async function enter(peer: Peer, nickname = '') {
  await peer.page.locator('.online-mode-entry').click();
  await expect(peer.page.getByLabel('닉네임', { exact: true })).toBeEnabled();
  if (nickname) await peer.page.getByLabel('닉네임', { exact: true }).fill(nickname);
}
async function create(peer: Peer, mode: 'matgo' | 'gostop' = 'matgo', isPublic = true) {
  await enter(peer, '공개방장');
  await expect(peer.page.getByLabel('방 공개 설정', { exact: true })).toHaveValue('private');
  await peer.page.getByLabel('게임 모드', { exact: true }).selectOption(mode);
  if (isPublic) await peer.page.getByLabel('방 공개 설정', { exact: true }).selectOption('public');
  await peer.page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(peer.page.locator('.online-waiting-room')).toBeVisible();
  await expect.poll(() => !!peer.view).toBe(true);
}
const row = (peer: Peer, code: string) => peer.page.getByTestId('public-room').filter({ has: peer.page.getByText(code, { exact: true }) });
const list = (peer: Peer) => peer.page.getByTestId('public-rooms');
async function publicLayout(peer: Peer) {
  await noOverflow(peer.page);
  expect(await peer.page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.online-public-rooms, .online-public-list, .online-public-list li')]
    .every(element => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
}

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: public quick join, live occupancy, full exclusion, play and F5 recovery`, async ({ openPeer }, testInfo) => {
    const observer = await openPeer(); await enter(observer);
    await expect(list(observer)).toContainText('현재 참가 가능한 공개방이 없습니다.');
    const host = await openPeer(); await create(host, mode); const code = host.view!.code;
    await expect(row(observer, code)).toContainText(mode === 'matgo' ? '2인 맞고' : '3인 고스톱');
    await expect(row(observer, code)).toContainText(`1 / ${mode === 'matgo' ? 2 : 3}`);
    await expect(row(observer, code)).not.toContainText('공개방장');
    await expect(row(observer, code).getByRole('button')).toBeDisabled();
    if (testInfo.project.name === 'desktop') {
      for (const width of [360, 375, 390, 412, 1440]) {
        await observer.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        await publicLayout(observer);
        await row(observer, code).getByRole('button').scrollIntoViewIfNeeded();
        await expect(row(observer, code).getByRole('button')).toBeInViewport();
      }
    }
    await publicLayout(observer);
    const players = [host];
    for (let seat = 1; seat < (mode === 'matgo' ? 2 : 3); seat++) {
      const guest = await openPeer(); await enter(guest, `목록친구${seat}`);
      await row(guest, code).getByRole('button').click();
      await expect(guest.page.locator('.online-waiting-room')).toBeVisible();
      await expect.poll(() => guest.view?.you).toBe(seat); players.push(guest);
      await noOverflow(guest.page);
      if (mode === 'gostop' && seat === 1) await expect(row(observer, code)).toContainText('2 / 3');
    }
    await expect(row(observer, code)).toHaveCount(0);
    await startRoom(players); await expect(row(observer, code)).toHaveCount(0);
    await playTurn(players);
    const guest = players[1], identity = { code, seat: guest.view!.you, name: guest.view!.connections[guest.view!.you].nickname };
    let listRequests = 0;
    guest.page.on('request', req => { if (req.postData()?.includes('"room:list"')) listRequests++; });
    guest.page.on('websocket', ws => ws.on('framesent', frame => { if (frame.payload.toString().includes('"room:list"')) listRequests++; }));
    await guest.page.reload(); await expect(guest.page.getByTestId('online-board')).toBeVisible();
    expect(guest.view!.code).toBe(identity.code); expect(guest.view!.you).toBe(identity.seat);
    expect(guest.view!.connections[identity.seat].nickname).toBe(identity.name);
    await expect(list(guest)).toHaveCount(0); expect(listRequests).toBe(0);
  });
}

test('private default stays undiscoverable while code/invite joins and invite priority work', async ({ openPeer }) => {
  const publicHost = await openPeer(); await create(publicHost);
  const host = await openPeer(); await create(host, 'gostop', false);
  const observer = await openPeer(); await enter(observer);
  await expect(row(observer, publicHost.view!.code)).toBeVisible();
  await expect(row(observer, host.view!.code)).toHaveCount(0);
  await observer.page.getByLabel('닉네임', { exact: true }).fill('코드친구');
  await observer.page.getByLabel('방 코드', { exact: true }).fill(host.view!.code);
  await observer.page.getByRole('button', { name: '참가하기', exact: true }).click();
  await expect(observer.page.locator('.online-waiting-room')).toBeVisible();
  const invite = await host.page.getByLabel('초대 링크', { exact: true }).inputValue();
  const guest = await openPeer(invite);
  await expect(guest.page.getByLabel('방 코드', { exact: true })).toHaveValue(host.view!.code);
  await expect(list(guest)).toHaveCount(0);
  await guest.page.getByLabel('닉네임', { exact: true }).fill('초대친구');
  await guest.page.getByRole('button', { name: '참가하기', exact: true }).click();
  await expect(guest.page.locator('.online-waiting-room')).toBeVisible();
  expect(guest.view!.code).toBe(host.view!.code);
  await guest.page.reload(); await expect(guest.page.locator('.online-waiting-room')).toBeVisible();
  await expect(list(guest)).toHaveCount(0); expect(guest.view!.you).toBe(2);
});

test('explicit lobby leave removes public room and returns to a refreshed list', async ({ openPeer }) => {
  const observer = await openPeer(); await enter(observer);
  const host = await openPeer(); await create(host); const code = host.view!.code;
  await expect(row(observer, code)).toBeVisible();
  await host.page.getByRole('button', { name: '방 나가기', exact: true }).click();
  await expect(row(observer, code)).toHaveCount(0);
  await expect(list(host)).toContainText('현재 참가 가능한 공개방이 없습니다.');
  await noOverflow(host.page);
});

test.describe('public grace expiry', () => {
  test.use({ scenario: 'reconnect-expiry' });
  test('disconnected public seat stays reserved until grace deletes its room', async ({ openPeer }) => {
    const observer = await openPeer(); await enter(observer);
    const host = await openPeer(); await create(host); const code = host.view!.code;
    await expect(row(observer, code)).toContainText('1 / 2');
    await host.page.goto('about:blank');
    await observer.page.getByRole('button', { name: '공개방 새로고침', exact: true }).click();
    await expect(row(observer, code)).toContainText('1 / 2');
    await expect(row(observer, code)).toHaveCount(0);
    await expect(list(observer)).toContainText('현재 참가 가능한 공개방이 없습니다.');
  });
});

type SocketGate = { upgraded: boolean; enabled: boolean; held: boolean; release: (kind: 'forward' | 'failure' | 'empty') => void };
type GateWindow = Window & { publicRoomGate: SocketGate };
async function installSocketGate(peer: Peer, event: 'room:join' | 'room:list') {
  await peer.page.evaluate(wanted => {
    const send = WebSocket.prototype.send;
    let pending: { socket: WebSocket; data: string; id: string } | undefined;
    const gate: SocketGate = { upgraded: false, enabled: false, held: false, release(kind) {
      if (!pending) throw new Error('No held request');
      const { socket, data, id } = pending; pending = undefined; gate.held = false;
      if (kind === 'forward') send.call(socket, data);
      else {
        if (kind === 'empty') socket.dispatchEvent(new MessageEvent('message', { data: '42["room:list",[]]' }));
        socket.dispatchEvent(new MessageEvent('message', { data: `43${id}[${JSON.stringify(kind === 'empty' ? { ok: true } : { ok: false, error: 'List unavailable' })}]` }));
      }
    } };
    Object.assign(window, { publicRoomGate: gate });
    WebSocket.prototype.send = function (data) {
      const wire = typeof data === 'string' ? data : '';
      if (wire === '5') gate.upgraded = true;
      const match = /^42(\d+)\[/.exec(wire);
      if (gate.enabled && match && JSON.parse(wire.slice(2 + match[1].length))[0] === wanted) {
        pending = { socket: this, data: wire, id: match[1] }; gate.held = true;
      } else send.call(this, data);
    };
  }, event);
}
async function upgraded(peer: Peer) {
  await expect.poll(() => peer.page.evaluate(() => (window as unknown as GateWindow).publicRoomGate.upgraded)).toBe(true);
  await peer.page.evaluate(() => { (window as unknown as GateWindow).publicRoomGate.enabled = true; });
}
async function held(peer: Peer) {
  await expect.poll(() => peer.page.evaluate(() => (window as unknown as GateWindow).publicRoomGate.held)).toBe(true);
}
async function release(peer: Peer, kind: 'forward' | 'failure' | 'empty') {
  await peer.page.evaluate(value => { (window as unknown as GateWindow).publicRoomGate.release(value); }, kind);
}

test('two browser quick joins against the same stale final seat cannot overbook', async ({ openPeer }) => {
  const host = await openPeer(); await create(host); const code = host.view!.code;
  const contenders = [await openPeer(), await openPeer()];
  for (const peer of contenders) {
    await installSocketGate(peer, 'room:join'); await enter(peer, 'Concurrent');
    await expect(row(peer, code)).toContainText('1 / 2'); await upgraded(peer);
  }
  // Hold both outgoing joins before either reaches the real server: both users
  // click the same stale row, without racing Playwright's actionability checks.
  await Promise.all(contenders.map(peer => row(peer, code).getByRole('button').click()));
  for (const peer of contenders) await held(peer);
  await Promise.all(contenders.map(peer => release(peer, 'forward')));
  await expect.poll(async () => (await Promise.all(contenders.map(peer => peer.page.locator('.online-waiting-room').count()))).reduce((a, b) => a + b, 0)).toBe(1);
  const loser = contenders.find(peer => !peer.view)!;
  await expect(loser.page.locator('.online-message')).toContainText('방이 가득 찼습니다.');
  await expect(row(loser, code)).toHaveCount(0);
  await expect.poll(() => host.view!.occupancy).toBe(2);
});

test('list loading and failure allow manual retry and do not block private creation', async ({ openPeer }) => {
  const peer = await openPeer(); await installSocketGate(peer, 'room:list'); await enter(peer, 'NewHost');
  await expect(list(peer)).toContainText('현재 참가 가능한 공개방이 없습니다.'); await upgraded(peer);
  await peer.page.getByRole('button', { name: '공개방 새로고침', exact: true }).click();
  await held(peer); await expect(list(peer)).toContainText('공개방을 불러오는 중입니다.');
  await release(peer, 'failure');
  await expect(list(peer).getByRole('alert')).toContainText('공개방 목록을 불러오지 못했습니다.');
  await peer.page.getByRole('button', { name: '공개방 새로고침', exact: true }).click();
  await held(peer); await release(peer, 'empty');
  await expect(list(peer)).toContainText('현재 참가 가능한 공개방이 없습니다.');
  await peer.page.getByRole('button', { name: '공개방 새로고침', exact: true }).click();
  await held(peer); await release(peer, 'failure');
  await expect(list(peer).getByRole('alert')).toBeVisible();
  await peer.page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(peer.page.locator('.online-waiting-room')).toBeVisible();
});

test('malformed visibility sent by a browser is rejected without creating or listing a room', async ({ openPeer }) => {
  const observer = await openPeer(); await enter(observer);
  await expect(list(observer)).toContainText('현재 참가 가능한 공개방이 없습니다.');
  const peer = await openPeer(); await installSocketGate(peer, 'room:list'); await enter(peer, '검증방장');
  await expect.poll(() => peer.page.evaluate(() => (window as unknown as GateWindow).publicRoomGate.upgraded)).toBe(true);
  await peer.page.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const wire = typeof data === 'string' ? data : '';
      const match = /^42(\d+)(\[.*)$/.exec(wire);
      if (match) {
        const packet = JSON.parse(match[2]);
        if (packet[0] === 'room:create-options') {
          packet[1].visibility = ['public'];
          send.call(this, `42${match[1]}${JSON.stringify(packet)}`); return;
        }
      }
      send.call(this, data);
    };
  });
  await peer.page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(peer.page.locator('.online-message')).toContainText('잘못된 방 공개 설정입니다.');
  await expect(peer.page.locator('.online-waiting-room')).toHaveCount(0);
  expect(peer.view).toBeNull();
  expect(await peer.page.evaluate(() => sessionStorage.getItem('gostop.online.reconnect') === null)).toBe(true);
  await observer.page.getByRole('button', { name: '공개방 새로고침', exact: true }).click();
  await expect(list(observer)).toContainText('현재 참가 가능한 공개방이 없습니다.');
});
