import test from 'node:test';
import assert from 'node:assert/strict';

async function cardModel() {
  const loaded = await import('../src/client/card.js').catch(() => null);
  assert.ok(loaded, 'card module must exist');
  return loaded;
}

test('direct 3080 HTML fallback is classified as local access, never as a subuser', async () => {
  const { gatewayIdentityRouteAvailable, resolveCardIdentity } = await cardModel();
  assert.equal(gatewayIdentityRouteAvailable('text/html; charset=utf-8'), false);
  assert.deepEqual(resolveCardIdentity(null, false), { kind: 'local' });
});

test('missing identity while the gateway route exists remains unknown instead of becoming a subuser', async () => {
  const { gatewayIdentityRouteAvailable, resolveCardIdentity } = await cardModel();
  assert.equal(gatewayIdentityRouteAvailable('application/json; charset=utf-8'), true);
  assert.deepEqual(resolveCardIdentity(null, true), { kind: 'loading' });
  assert.deepEqual(resolveCardIdentity({
    me: { username: 'guest', role: 'user' }, users: [],
  }, true), { kind: 'user', username: 'guest' });
});


test('direct local access uses the same real patch status model as gateway admins', async () => {
  const { resolvePatchPresentation } = await cardModel();
  assert.equal(resolvePatchPresentation({ kind: 'local' }, null), 'unknown');
  assert.equal(resolvePatchPresentation({ kind: 'local' }, {
    settingsHostMode: true, whitelist: true,
  }), 'ok');
  assert.equal(resolvePatchPresentation({ kind: 'admin', username: 'admin' }, {
    settingsHostMode: false, whitelist: true,
  }), 'bad');
});
