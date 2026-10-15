import { test, expect, noOverflow, playTurn } from './fixtures';
import { applyAction } from '../../server/game';
import { settlementMatch } from '../settlement-fixture';

test.use({ scenario: 'settlement' });
for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: authoritative breakdown, captured cards, finished reload and rematch`, async ({ createRoom }, testInfo) => {
    const peers = await createRoom(mode);
    const fixture = settlementMatch(mode);
    const expected = applyAction(fixture, 0, { roomCode: 'ABC123', revision: 0, type: 'stop' }).result!;
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await expect.poll(() => peers.every(p => p.view!.game!.phase === 'finished')).toBe(true);
    for (const peer of peers) {
      const detail = peer.page.getByLabel(mode === 'matgo' ? '맞고 상세 정산' : '고스톱 상세 정산', { exact: true });
      await expect(detail).toBeVisible();
      const result = peer.view!.game!.result!;
      expect(JSON.stringify(result) === JSON.stringify(expected)).toBe(true);
      const settlement = mode === 'matgo' ? result.settlement! : result.gostopSettlement!;
      for (const item of settlement.scoreItems!) {
        await expect(detail.getByTestId(`score-item-${item.id}`)).toContainText(item.label);
        await expect(detail.getByTestId(`score-item-${item.id}`)).toContainText(`+${item.points}점`);
      }
      await expect(detail.getByTestId('settlement-total')).toContainText(
        `${mode === 'matgo' ? result.settlement!.finalScore : result.gostopSettlement!.totalReceived}점`);
      if (mode === 'gostop') {
        const three = result.gostopSettlement!;
        expect(three.goBakPayer).toBe(1);
        for (const payer of three.loserSettlements) {
          await expect(detail.getByTestId(`payer-${payer.loser}`)).toContainText(`${payer.payment}점 부담`);
          await expect(detail.getByTestId(`payer-${payer.loser}`)).toContainText(`대납 전 ${payer.normalPayment}점`);
        }
      }
      const otherIds = peers.filter(p => p !== peer).flatMap(p => p.view!.game!.hand.map(card => card.id));
      expect(otherIds.every(id => !JSON.stringify(peer.view).includes(`"${id}"`))).toBe(true);
      await noOverflow(peer.page);
    }

    const viewer = peers[0];
    const widths = testInfo.project.name === 'desktop' ? [375, 412, 1440] : [viewer.page.viewportSize()!.width];
    for (const width of widths) {
      if (testInfo.project.name === 'desktop') await viewer.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      for (const player of viewer.view!.game!.players) {
        await viewer.page.getByRole('button', { name: `${viewer.view!.connections[player.seat].nickname} 획득패 보기`, exact: true }).click();
        const modal = viewer.page.getByRole('dialog');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.capture-zoom-summary')).toContainText(`${player.score}점`);
        await expect.poll(() => modal.evaluate(element => {
          const r = element.getBoundingClientRect();
          return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
        })).toBe(true);
        await noOverflow(viewer.page);
        await viewer.page.getByRole('button', { name: '먹은 패 크게 보기 닫기', exact: true }).click();
        await expect(modal).toHaveCount(0);
      }
    }
    await viewer.page.reload();
    await expect(viewer.page.getByTestId('score-breakdown')).toBeVisible();
    expect(JSON.stringify(viewer.view!.game!.result) === JSON.stringify(expected)).toBe(true);
    for (const peer of peers) await peer.page.getByRole('button', { name: '다시하기', exact: true }).click();
    await expect.poll(() => peers.every(p => p.view!.round === 2)).toBe(true);
    for (const peer of peers) {
      await expect(peer.page.getByTestId('score-breakdown')).toHaveCount(0);
      await expect(peer.page.getByTestId('online-board')).toBeVisible();
    }
    await playTurn(peers);
  });
}
