import { test, expect, noOverflow } from './fixtures';

test('online primary section precedes accessible AI actions at every viewport', async ({ openPeer }) => {
  const { page } = await openPeer();
  const primary = page.getByRole('region', { name: '함께 치는 즐거움' });
  const secondary = page.getByRole('region', { name: 'AI 연습' });
  const online = page.getByRole('button', { name: '온라인 플레이', exact: true });
  await expect(primary).toHaveClass('home-online-primary');
  await expect(secondary).toHaveClass('home-ai-secondary');
  await expect(primary.getByRole('button')).toHaveCount(1);
  await expect(secondary.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('온라인 맞고 / 고스톱');
  for (const width of [360, 375, 390, 412, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await noOverflow(page);
    await expect(online).toBeInViewport();
    const onlineBox = (await online.boundingBox())!;
    const primaryBox = (await primary.boundingBox())!;
    const secondaryBox = (await secondary.boundingBox())!;
    expect(primaryBox.y + primaryBox.height).toBeLessThanOrEqual(secondaryBox.y);
    expect(primaryBox.height).toBeGreaterThan(secondaryBox.height);
    for (const name of ['AI 2인 맞고', 'AI 3인 고스톱']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(onlineBox.y + onlineBox.height);
      expect(onlineBox.height).toBeGreaterThan(box.height);
    }
  }
  await page.reload();
  await expect(online).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(online).toBeFocused();
  await expect(online).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('닉네임', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('방 제목', { exact: true })).toBeVisible();
  await expect(page.getByTestId('public-rooms')).toBeVisible();
  await page.getByRole('button', { name: '최근 경기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '최근 경기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '온라인으로' }).click();
  await expect(page.getByLabel('방 제목', { exact: true })).toBeVisible();
});

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: AI entry retains its existing start behavior`, async ({ openPeer }) => {
    const { page } = await openPeer();
    await page.getByRole('button', { name: mode === 'matgo' ? 'AI 2인 맞고' : 'AI 3인 고스톱', exact: true }).click();
    await expect(page.locator('main.game')).toBeVisible();
    if (mode === 'matgo') {
      await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeVisible();
      await expect(page.locator('.player-area .card')).toHaveCount(0);
      await page.getByRole('button', { name: '게임 시작', exact: true }).click();
      await expect(page.locator('.player-area .card')).toHaveCount(10);
    } else {
      await expect(page.locator('.gostop3-player-hand .card')).toHaveCount(7);
    }
    await page.getByRole('button', { name: '게임 선택' }).click();
    await expect(page.getByRole('button', { name: '온라인 플레이', exact: true })).toBeVisible();
  });
}

test('online form selections survive a visit to recent games', async ({ openPeer }) => {
  const { page } = await openPeer();
  await page.getByRole('button', { name: '온라인 플레이', exact: true }).click();
  await page.getByLabel('닉네임', { exact: true }).fill('친구');
  await page.getByLabel('방 제목', { exact: true }).fill('우리들의 방');
  await page.getByLabel('게임 모드', { exact: true }).selectOption('gostop');
  await page.getByLabel('방 공개 설정', { exact: true }).selectOption('public');
  await page.getByLabel('초보자 도움말 사용 가능', { exact: true }).check();
  await page.getByLabel('방 코드', { exact: true }).fill('ABC123');
  await page.getByRole('button', { name: '최근 경기', exact: true }).click();
  await page.getByRole('button', { name: '온라인으로' }).click();
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('친구');
  await expect(page.getByLabel('방 제목', { exact: true })).toHaveValue('우리들의 방');
  await expect(page.getByLabel('게임 모드', { exact: true })).toHaveValue('gostop');
  await expect(page.getByLabel('방 공개 설정', { exact: true })).toHaveValue('public');
  await expect(page.getByLabel('초보자 도움말 사용 가능', { exact: true })).toBeChecked();
  await expect(page.getByLabel('방 코드', { exact: true })).toHaveValue('ABC123');
});
