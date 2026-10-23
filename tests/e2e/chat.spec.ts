import { test, expect, noOverflow, playTurn, startRoom, type Peer } from './fixtures';
import { QUICK_CHAT_PRESETS } from '../../src/online/quickChat';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: quick chat uses ordinary user messages without changing game state`, async ({ createRoom, openPeer }) => {
    const players = [...await createRoom(mode)];
    const foreign = (await openPeer());
    await foreign.page.locator('.online-mode-entry').click();
    await foreign.page.getByLabel('닉네임', { exact: true }).fill('다른방');
    await foreign.page.getByRole('button', { name: '방 만들기', exact: true }).click();
    await expect(foreign.page.locator('.online-waiting-room')).toBeVisible();
    const spectator = await openPeer();
    await spectator.page.locator('.online-mode-entry').click();
    await spectator.page.getByLabel('방 코드', { exact: true }).fill(players[0].view!.code);
    await spectator.page.getByRole('button', { name: '관전하기', exact: true }).click();
    await expect(spectator.page.getByTestId('spectator-board')).toBeVisible();
    const all = [...players, spectator];
    for (const peer of all) await openChat(peer);
    const before = players.map(p => JSON.stringify(p.view));
    const spectatorBefore = JSON.stringify(spectator.spectatorView);
    const foreignBefore = JSON.stringify(foreign.chat);
    for (const preset of QUICK_CHAT_PRESETS) {
      await expect(players[0].page.getByRole('group', { name: '빠른 채팅' }).getByRole('button', { name: preset.label, exact: true })).toBeVisible();
    }
    const input = players[0].page.getByLabel('메시지 (한 줄, Enter로 전송)', { exact: true });
    await input.fill('작성 중인 초안');
    const sends = [[players[0], 'ㅋㅋㅋㅋ', 'ㅋㅋㅋㅋ'], [players[1], '😂', '기쁨의 눈물 얼굴'], [spectator, '👍', '엄지 올리기']] as const;
    for (const [sender, text, label] of sends) {
      const button = sender.page.getByRole('group', { name: '빠른 채팅' }).getByRole('button', { name: label, exact: true });
      if (sender.page.viewportSize()!.width <= 412) await button.tap();
      else { await button.focus(); await sender.page.keyboard.press('Enter'); }
      for (const receiver of all) {
        await expect(receiver.page.locator('.chat-user').filter({ hasText: text })).toHaveCount(1);
        await expect.poll(() => receiver.chat?.messages.at(-1)?.text).toBe(text);
        expect(receiver.chat!.messages.at(-1)!.type).toBe('user');
      }
      expect(await sender.page.locator('#room-chat-input').evaluate(el => el === document.activeElement)).toBe(false);
    }
    await expect(input).toHaveValue('작성 중인 초안');
    expect(players.map(p => JSON.stringify(p.view))).toEqual(before);
    expect(JSON.stringify(spectator.spectatorView)).toBe(spectatorBefore);
    expect(JSON.stringify(foreign.chat)).toBe(foreignBefore);
    const last = players[0].chat!.messages.at(-1)!;
    expect(last.type === 'user' && last.sender).toEqual({ role: 'spectator', nickname: '관전자 1' });
    for (const width of [360, 375, 390, 412]) {
      await players[0].page.setViewportSize({ width, height: 844 });
      await noOverflow(players[0].page);
      const sizes = await players[0].page.locator('.room-chat-quick button').evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().height));
      expect(sizes.every(height => height >= 44)).toBe(true);
    }
    for (const peer of all) await peer.page.getByRole('button', { name: '채팅 닫기' }).click();
    await playTurn(players);
  });
}

async function openChat(peer: Peer) {
  await peer.page.getByRole('button', { name: /^채팅(?: \(\d+\))?$/ }).click();
  await expect(peer.page.getByLabel('메시지 (한 줄, Enter로 전송)', { exact: true })).toBeVisible();
}
async function send(peer: Peer, text: string) {
  await peer.page.getByLabel('메시지 (한 줄, Enter로 전송)', { exact: true }).fill(text);
  await peer.page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(peer.page.locator('.room-chat-messages li').filter({ hasText: text })).toHaveCount(1);
}

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: lobby/game chat, room isolation, XSS, spectator and reload`, async ({ createRoom, openPeer }, testInfo) => {
    const peers = [...await createRoom(mode, { start: false })];
    await openChat(peers[0]);
    await send(peers[0], '준비되면 시작해요');
    await expect(peers[1].page.getByRole('button', { name: /^채팅 \(\d+\)$/ })).toBeVisible();
    await openChat(peers[1]); await send(peers[1], '네 좋아요');
    await expect(peers[0].page.locator('.room-chat-messages')).toContainText('네 좋아요');
    expect(peers[0].chat!.messages.filter(m => m.type === 'user').map(m => m.text)).toEqual(['준비되면 시작해요', '네 좋아요']);
    await peers[0].page.getByRole('button', { name: '채팅 닫기' }).click();
    await peers[1].page.getByRole('button', { name: '채팅 닫기' }).click();
    await startRoom(peers);
    const foreign = await openPeer();
    await foreign.page.locator('.online-mode-entry').click();
    await expect(foreign.page.getByLabel('닉네임', { exact: true })).toBeEnabled();
    await foreign.page.getByLabel('닉네임', { exact: true }).fill('다른방');
    await foreign.page.getByRole('button', { name: '방 만들기', exact: true }).click();
    await expect(foreign.page.locator('.online-waiting-room')).toBeVisible();
    const foreignHistory = JSON.stringify(foreign.chat);
    const spectator = await openPeer();
    await spectator.page.locator('.online-mode-entry').click();
    await spectator.page.getByLabel('방 코드', { exact: true }).fill(peers[0].view!.code);
    await spectator.page.getByRole('button', { name: '관전하기', exact: true }).click();
    await expect(spectator.page.getByTestId('spectator-board')).toBeVisible();
    const before = JSON.stringify(peers[0].view);
    await openChat(spectator); await send(spectator, '재미있게 보고 있어요');
    await expect.poll(() => peers[0].chat?.messages.at(-1)?.text).toBe('재미있게 보고 있어요');
    expect(JSON.stringify(peers[0].view)).toBe(before);
    await openChat(peers[0]);
    await expect(peers[0].page.locator('.chat-user').filter({ hasText: '재미있게 보고 있어요' })).toContainText('[관전]');
    await peers[0].page.getByRole('button', { name: '채팅 닫기' }).click();
    await playTurn(peers);
    const stateBefore = JSON.stringify(peers[0].view);
    await openChat(peers[0]);
    const script = '<img src=x onerror="window.chatXss=1"><script>window.chatXss=1</script>';
    await send(peers[0], script);
    expect(await peers[0].page.evaluate(() => (window as unknown as { chatXss?: number }).chatXss)).toBeUndefined();
    expect(await peers[0].page.locator('.room-chat-messages img, .room-chat-messages script').count()).toBe(0);
    expect(JSON.stringify(peers[0].view)).toBe(stateBefore);
    expect(JSON.stringify(foreign.chat)).toBe(foreignHistory);
    for (const peer of peers.slice(1)) {
      await openChat(peer);
      await expect(peer.page.locator('.room-chat-messages')).toContainText(script);
    }
    const widths = testInfo.project.name === 'desktop' ? [375, 412, 1440] : [peers[0].page.viewportSize()!.width];
    for (const width of widths) {
      await peers[0].page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await noOverflow(peers[0].page);
      const separated = await peers[0].page.evaluate(() => {
        const chat = document.querySelector('.room-chat')!.getBoundingClientRect();
        const board = document.querySelector('.online-room-content')!.getBoundingClientRect();
        return chat.top >= board.bottom - 1 || chat.left >= board.right - 1;
      });
      expect(separated).toBe(true);
    }
    await peers[1].page.reload();
    await expect(peers[1].page.getByTestId('online-board')).toBeVisible();
    await openChat(peers[1]);
    await expect(peers[1].page.locator('.room-chat-messages')).toContainText(script);
    await spectator.page.reload(); await expect(spectator.page.getByTestId('spectator-board')).toBeVisible();
    await openChat(spectator); await expect(spectator.page.locator('.room-chat-messages')).toContainText(script);
    await peers[0].page.getByRole('button', { name: '채팅 닫기' }).click();
    await expect(peers[0].page.getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  });
}

test.describe('chat survives settlement and rematch', () => {
  test.use({ scenario: 'history' });
  test('same Room history stays through rounds and clears on leave', async ({ createRoom }) => {
    const peers = await createRoom('matgo');
    await openChat(peers[0]); await send(peers[0], '다음 판도 해요');
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await expect(peers[0].page.getByRole('button', { name: '다시하기', exact: true })).toBeVisible();
    await expect(peers[0].page.locator('.room-chat-messages')).toContainText('다음 판도 해요');
    for (const peer of peers) { await peer.page.getByRole('button', { name: '다시하기', exact: true }).click(); }
    await expect.poll(() => peers[0].view?.round).toBe(2);
    await expect(peers[0].page.locator('.room-chat-messages')).toContainText('다음 판도 해요');
    await peers[0].page.getByRole('button', { name: '채팅 닫기' }).click();
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await peers[0].page.locator('.game-over-modal').getByRole('button', { name: '방 나가기', exact: true }).click();
    await expect(peers[0].page.getByLabel('방 채팅', { exact: true })).toHaveCount(0);
  });
});
