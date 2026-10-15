import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingSeconds } from '../src/online/countdown';
test('countdown clamps at zero and preserves full input time during presentation', () => {
  const timer = { startsAt: 2000, turnDeadline: 32000, timedPlayerSeat: 0 as const, decisionPhase: 'play' as const };
  assert.equal(remainingSeconds(timer, 0), 30);
  assert.equal(remainingSeconds(timer, 22000), 10);
  assert.equal(remainingSeconds(timer, 33000), 0);
});
