import test from 'node:test';
import assert from 'node:assert/strict';

async function policy() {
  const loaded = await import('../src/request-policy.js').catch(() => null);
  assert.ok(loaded, 'request-policy module must exist');
  return loaded;
}

test('admin requests are not restricted by the subuser gateway policy', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/settings.mutate', 'admin'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/credentials.set', 'admin'), { allowed: true });
});

test('subusers may read existing models and select one but cannot discover or configure providers', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/llm.models', 'user'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/session.selectModel', 'user'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/llm.discoverModels', 'user'), {
    allowed: false, reason: 'settings-write',
  });
});

test('subuser settings and credential writes are denied while non-sensitive settings description remains readable', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/settings.describe', 'user'), { allowed: true });
  for (const pathname of [
    '/api/settings.openDocument', '/api/settings.update', '/api/settings.replace', '/api/settings.mutate',
    '/api/credentials.set', '/api/credentials.unset',
  ]) {
    assert.deepEqual(classifyGatewayRequest('POST', pathname, 'user'), {
      allowed: false, reason: 'settings-write',
    });
  }
});

test('unknown API mutations fail closed for subusers but static and page reads remain available', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/new-dangerous-operation', 'user'), {
    allowed: false, reason: 'unknown-mutation',
  });
  assert.deepEqual(classifyGatewayRequest('GET', '/assets/main.js', 'user'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('GET', '/', 'user'), { allowed: true });
});

test('subusers may register a workspace only after the gateway validates its path', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/workspace.create', 'user'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/dsh-access/unknown', 'user'), { allowed: false, reason: 'unknown-mutation' });
  assert.deepEqual(classifyGatewayRequest('POST', '/aionui-panel/unknown', 'user'), { allowed: false, reason: 'unknown-mutation' });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/workspace.delete', 'user'), { allowed: true });
});

test('subusers cannot mutate the global workspace registry or agent preset catalog', async () => {
  const { classifyGatewayRequest } = await policy();
  for (const pathname of [
    '/api/workspace.rename', '/api/workspace.insertBefore',
    '/api/agentPreset.copy', '/api/agentPreset.openDocument', '/api/agentPreset.remove',
  ]) {
    assert.equal(classifyGatewayRequest('POST', pathname, 'user').allowed, false);
  }
});

test('subusers cannot read admin-only plugin endpoints', async () => {
  const { classifyGatewayRequest } = await policy();
  for (const pathname of ['/api/dsh-ssh', '/api/dsh-uploads', '/api/skin-center', '/modlens']) {
    assert.deepEqual(classifyGatewayRequest('GET', pathname, 'user'), {
      allowed: false, reason: 'global-mutation',
    });
  }
});


test('subusers cannot open an unrestricted native directory picker', async () => {
  const { classifyGatewayRequest } = await policy();
  assert.deepEqual(classifyGatewayRequest('POST', '/api/host.pickDirectory', 'user'), {
    allowed: false, reason: 'unknown-mutation',
  });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/host.listDirectory', 'user'), { allowed: true });
  assert.deepEqual(classifyGatewayRequest('POST', '/api/host.createDirectory', 'user'), { allowed: true });
});
