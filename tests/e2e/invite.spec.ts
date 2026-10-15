import { test, expect, noOverflow, playTurn, startRoom } from './fixtures';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: invitation copy, explicit nickname join and reconnect priority`, async ({ openPeer, site }, testInfo) => {
    const host = await openPeer(), peers = [host];
    await host.page.locator('.online-mode-entry').click();
    await host.page.getByLabel('닉네임', { exact: true }).fill('초대방장');
    await host.page.getByLabel('게임 모드', { exact: true }).selectOption(mode);
    await host.page.getByRole('button', { name: '방 만들기', exact: true }).click();
    const field = host.page.getByLabel('초대 링크', { exact: true });
    await expect(field).toBeVisible();
    await expect.poll(() => !!host.view).toBe(true);
    const link = await field.inputValue(), code = host.view!.code, url = new URL(link);
    expect(url.origin).toBe(new URL(site).origin);
    expect([...url.searchParams]).toEqual([['room', code]]);
    expect(url.hash).toBe('');
    expect(await host.page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('gostop.online.reconnect')!);
      const link = document.querySelector<HTMLInputElement>('input[aria-label="초대 링크"]')!.value;
      return !link.includes(session.token);
    })).toBe(true);
    await host.page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value: string) => { Object.assign(window, { copiedInvite: value }); },
      } });
    });
    await host.page.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
    await expect(host.page.locator('.online-room-code [role="status"]')).toHaveText('초대 링크를 복사했습니다.');
    expect(await host.page.evaluate(() => (window as unknown as { copiedInvite: string }).copiedInvite) === link).toBe(true);
    await host.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('denied'); },
    } }));
    await host.page.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
    await expect(host.page.locator('.online-room-code [role="status"]')).toContainText('직접 선택해 복사');
    await host.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await host.page.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
    await expect(host.page.locator('.online-room-code [role="status"]')).toContainText('직접 선택해 복사');
    await field.focus();
    expect(await field.evaluate(element => {
      const input = element as HTMLInputElement;
      return input.readOnly && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    })).toBe(true);

    for (let seat = 1; seat < (mode === 'matgo' ? 2 : 3); seat++) {
      const lower = new URL(link); lower.searchParams.set('room', code.toLowerCase());
      const peer = await openPeer(lower.href); peers.push(peer);
      await expect(peer.page.getByLabel('방 코드', { exact: true })).toHaveValue(code);
      await expect(peer.page.getByLabel('닉네임', { exact: true })).toHaveValue('');
      await expect(peer.page.getByRole('button', { name: '참가하기', exact: true })).toBeDisabled();
      expect(peer.view === null).toBe(true);
      await peer.page.getByLabel('닉네임', { exact: true }).fill(`초대친구${seat}`);
      await peer.page.getByRole('button', { name: '참가하기', exact: true }).click();
      await expect(peer.page.locator('.online-waiting-room')).toBeVisible();
      await expect.poll(() => peer.view?.code === code).toBe(true);
      expect(new URL(peer.page.url()).searchParams.has('room')).toBe(false);
    }
    if (testInfo.project.name === 'desktop') {
      for (const width of [375, 412, 1440]) {
        for (const peer of peers) {
          await peer.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
          await noOverflow(peer.page);
        }
      }
    }
    for (const peer of peers) await noOverflow(peer.page);

    const guest = peers[1];
    let joins = 0;
    guest.page.on('websocket', socket => socket.on('framesent', event => {
      if (event.payload.toString().includes('"room:join"')) joins++;
    }));
    guest.page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/socket.io/') && request.postData()?.includes('"room:join"')) joins++;
    });
    const conflictingCode = code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    const conflictingReload = async () => {
      await guest.page.evaluate(otherCode => {
        const next = new URL(location.href); next.searchParams.set('room', otherCode);
        history.replaceState(history.state, '', next);
      }, conflictingCode);
      await guest.page.reload();
    };
    await conflictingReload();
    await expect(guest.page.locator('.online-waiting-room')).toBeVisible();
    expect(guest.view!.code === code && guest.view!.you === 1 && guest.view!.connections[1].nickname === '초대친구1').toBe(true);
    await startRoom(peers);
    await expect.poll(() => peers.every(p => !!p.view!.game)).toBe(true);
    const game = JSON.stringify(guest.view!.game);
    await conflictingReload();
    await expect(guest.page.getByTestId('online-board')).toHaveAttribute('data-seat', '1');
    expect(JSON.stringify(guest.view!.game) === game).toBe(true);
    expect(new URL(guest.page.url()).searchParams.has('room')).toBe(false);
    expect(joins).toBe(0);
    await playTurn(peers);
  });

  test(`${mode}: full lobby and started game invitations use the existing server rejection`, async ({ createRoom, openPeer }) => {
    const players = [...await createRoom(mode, { start: false })];
    const link = await players[0].page.getByLabel('초대 링크', { exact: true }).inputValue();
    const outsider = await openPeer(link);
    await outsider.page.getByLabel('닉네임', { exact: true }).fill('새친구');
    await outsider.page.getByRole('button', { name: '참가하기', exact: true }).click();
    await expect(outsider.page.getByRole('status')).toContainText('방이 가득 찼습니다.');
    expect(outsider.view === null).toBe(true);
    await startRoom(players);
    await outsider.page.getByRole('button', { name: '참가하기', exact: true }).click();
    await expect(outsider.page.getByRole('status')).toContainText('방이 가득 찼습니다.');
    expect(outsider.view === null).toBe(true);
    await noOverflow(outsider.page);
  });
}

test('invalid and nonexistent invitation codes remain safe, editable and server validated', async ({ openPeer, site }) => {
  const peer = await openPeer(`${site}/?room=`);
  for (const query of ['room=', 'room=AB', 'room=ABCDEFG', 'room=%3Cscript%3E', 'room=ABC123&room=DEF456']) {
    await peer.page.goto(`${site}/?${query}`);
    await expect(peer.page.getByLabel('방 코드', { exact: true })).toHaveValue('');
    await expect(peer.page.getByRole('status')).toContainText('초대 링크의 방 코드가 올바르지 않습니다.');
    await expect(peer.page.getByRole('button', { name: '참가하기', exact: true })).toBeDisabled();
    await noOverflow(peer.page);
  }
  await peer.page.goto(`${site}/?room=ABC123`);
  await peer.page.getByLabel('닉네임', { exact: true }).fill('새친구');
  await peer.page.getByRole('button', { name: '참가하기', exact: true }).click();
  await expect(peer.page.getByRole('status')).toContainText('방을 찾을 수 없습니다.');
  await expect(peer.page.getByLabel('방 코드', { exact: true })).toBeEditable();
  expect(peer.view === null).toBe(true);
});
