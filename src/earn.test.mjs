import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubProvider, payoutOrder } from './earn.mjs';

test('stubProvider is honestly marked unconfigured', () => {
  assert.equal(stubProvider.configured, false);
});

test('stubProvider.createIntent rejects with an explicit, honest reason -- never a silent success', async () => {
  await assert.rejects(
    () => stubProvider.createIntent({ id: 'o1', actor: 'p1', sku: 's1', provider: 'zbd' }, { id: 's1', name: 'x', blurb: 'x', priceUsd: '0', priceHive: '0' }),
    /not a working payout adapter/,
  );
});

test('stubProvider.settle never reports cleared', async () => {
  const result = await stubProvider.settle({ id: 'o1', actor: 'p1', sku: 's1', provider: 'zbd' }, { id: 's1', name: 'x', blurb: 'x', priceUsd: '0', priceHive: '0' });
  assert.equal(result.cleared, false);
});

test('payoutOrder sets direction: "payout", the rails doc\'s additive, non-breaking field', () => {
  const order = payoutOrder('o1', 'player-1', 'reward-tier-1', 'zbd');
  assert.equal(order.direction, 'payout');
  assert.equal(order.actor, 'player-1');
});
