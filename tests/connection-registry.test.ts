import test from 'node:test';
import assert from 'node:assert/strict';

async function registryModule() {
  const loaded = await import('../src/connection-registry.js').catch(() => null);
  assert.ok(loaded, 'connection-registry module must exist');
  return loaded;
}

test('revoking a user closes every active connection with the same explicit reason', async () => {
  const { UserConnectionRegistry } = await registryModule();
  const registry = new UserConnectionRegistry();
  const reasons: string[] = [];
  registry.track(2, (reason: string) => reasons.push(`ws:${reason}`));
  registry.track(2, (reason: string) => reasons.push(`sse:${reason}`));
  registry.track(3, (reason: string) => reasons.push(`other:${reason}`));

  assert.equal(registry.revoke(2, 'account-banned'), 2);
  assert.deepEqual(reasons, ['ws:account-banned', 'sse:account-banned']);
  assert.equal(registry.count(2), 0);
  assert.equal(registry.count(3), 1);
});

test('connection cleanup removes only the connection that actually closed', async () => {
  const { UserConnectionRegistry } = await registryModule();
  const registry = new UserConnectionRegistry();
  const first = registry.track(2, () => undefined);
  registry.track(2, () => undefined);
  first();
  assert.equal(registry.count(2), 1);
});
