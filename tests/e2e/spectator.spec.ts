import { test, expect, noOverflow, playTurn } from './fixtures';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: spectator hides hands, follows play, restores on reload and leaves independently`, async ({ createRoom, openPeer, site }) => {
    const players = [...await createRoom(mode)];
    const observer = await openPeer();
    const page = observer.page;
    await page.locator('.online-mode-entry').click();
    await page.getByLabel('방 코드', { exact: true }).fill(players[0].view!.code);
    const before = players[0].view!;
    await page.getByRole('button', { name: '관전하기', exact: true }).click();
    const board = page.getByTestId('spectator-board');
    await expect(board).toBeVisible();
    await expect(page.getByText('관전 중', { exact: true })).toBeVisible();
    await expect(page.locator('.spectator-player')).toHaveCount(players.length);
    await expect(page.locator('.spectator-hand .card')).toHaveCount(0);
    await expect(page.getByTestId('own-hand')).toHaveCount(0);
    const privateIds = players.flatMap(p => p.view!.game!.hand.map(card => card.id));
    await expect.poll(() => !!observer.spectatorView).toBe(true);
    expect(privateIds.every(id => !JSON.stringify(observer.spectatorView).includes(`"${id}"`))).toBe(true);
    const domIds = await page.locator('.card').evaluateAll(cards => cards.map(card =>
      `${parseInt(card.querySelector('.card-month')!.textContent!)}-${card.querySelector('.card-index')!.textContent!.trim()}`));
    expect(privateIds.every(id => !domIds.includes(id))).toBe(true);
    await expect(page.locator('.spectator-table .card')).toHaveCount(before.game!.floor.length);
    await expect(page.getByRole('timer')).toBeVisible();
    expect(players[0].view!.turnTimer!.turnDeadline).toBe(before.turnTimer!.turnDeadline);
    for (const label of ['GO', 'STOP', '준비', '게임 시작', '다시하기']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    for (const width of [360, 375, 390, 412]) {
      await page.setViewportSize({ width, height: 844 }); await noOverflow(page);
      await page.getByTestId('game-log-toggle').click();
      await expect(page.getByTestId('game-log-panel')).toBeVisible();
      await page.getByTestId('game-log-toggle').click();
      await page.getByRole('button', { name: '방 나가기', exact: true }).scrollIntoViewIfNeeded();
    }
    const rejected = await page.evaluate(async () => {
      const modulePath = '/node_modules/.vite/deps/socket__io-client.js';
      const { io } = await import(/* @vite-ignore */ modulePath) as typeof import('socket.io-client');
      const raw = sessionStorage.getItem('gostop.online.reconnect')!;
      const session = JSON.parse(raw);
      const socket = io({ transports: ['websocket'], forceNew: true });
      try {
        await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        let revision = 0;
        socket.on('room:spectator-state', view => { revision = view.game.revision; });
        const resumed = await socket.timeout(5000).emitWithAck('room:spectator-resume', { roomCode: session.roomCode, token: session.token });
        if (!resumed.ok) return false;
        for (const type of ['play', 'choose', 'go', 'stop', 'bomb', 'shake', 'bomb-pass']) {
          const reply = await socket.timeout(5000).emitWithAck('game:action', { roomCode: session.roomCode, revision, type });
          if (reply.ok) return false;
        }
        return true;
      } finally {
        socket.disconnect();
        sessionStorage.setItem('gostop.online.reconnect', raw);
      }
    });
    expect(rejected).toBe(true);
    await page.reload();
    await expect(board).toBeVisible();
    await playTurn(players);
    await expect(board).toHaveAttribute('data-revision', String(players[0].view!.game!.revision));
    await expect(board).toHaveAttribute('data-turn', '1');
    await page.reload();
    await expect(board).toBeVisible();
    await expect(page.locator('.spectator-hand .card')).toHaveCount(0);
    await page.goto('about:blank');
    await playTurn(players);
    await page.goto(site);
    await expect(board).toHaveAttribute('data-revision', String(players[0].view!.game!.revision));
    await page.getByRole('button', { name: '방 나가기', exact: true }).click();
    await expect(board).toHaveCount(0);
    await expect(players[0].page.getByTestId('online-board')).toBeVisible();
    await playTurn(players);
  });
}

test.describe('spectators stay for rematches', () => {
  test.use({ scenario: 'rematch' });
  for (const mode of ['matgo', 'gostop'] as const) test(`${mode}: finished result and next round`, async ({ createRoom, openPeer }) => {
    const players = [...await createRoom(mode)];
    const observer = await openPeer();
    await observer.page.locator('.online-mode-entry').click();
    await observer.page.getByLabel('방 코드', { exact: true }).fill(players[0].view!.code);
    await observer.page.getByRole('button', { name: '관전하기', exact: true }).click();
    await expect(observer.page.getByTestId('spectator-board')).toBeVisible();
    await players[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await expect(observer.page.getByRole('region', { name: '게임 종료 결과' })).toBeVisible();
    await expect(observer.page.getByRole('button', { name: '다시하기', exact: true })).toHaveCount(0);
    for (const player of players) await player.page.getByRole('button', { name: '다시하기', exact: true }).click();
    await expect(observer.page.getByTestId('spectator-board')).toHaveAttribute('data-round', '2');
    await expect(observer.page.locator('.spectator-hand .card')).toHaveCount(0);
    await noOverflow(observer.page);
  });
});
