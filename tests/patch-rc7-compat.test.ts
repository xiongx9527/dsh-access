import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyRemotePatch, patchStatus } from '../src/patch.js';

function fixture(whitelist: string, workspace?: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-access-patch-'));
  const settings = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js');
  const apiProxy = path.join(root, 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js');
  mkdirSync(path.dirname(settings), { recursive: true });
  mkdirSync(path.dirname(apiProxy), { recursive: true });
  writeFileSync(settings, 'connection.isLoopback ? "host" : "memory"');
  writeFileSync(apiProxy, whitelist);
  if (workspace !== undefined) {
    const file = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, workspace);
  }
  return { root, apiProxy };
}

test('rc.7 without WEB_SETTINGS_NAMESPACES treats whitelist as natively satisfied', () => {
  const { root } = fixture('export function settingsDescribe() {}');
  assert.equal(patchStatus(root).whitelist, true);
  assert.equal(applyRemotePatch(root), 'applied');
  assert.deepEqual(patchStatus(root), { settingsHostMode: true, whitelist: true, workspaceSearch: true });
  assert.equal(applyRemotePatch(root), 'unchanged');
});

test('rc.6 appends dsh-access without replacing existing namespaces', () => {
  const { root, apiProxy } = fixture('const WEB_SETTINGS_NAMESPACES = ["agent-loop", "third-party"];');
  assert.equal(applyRemotePatch(root), 'applied');
  const source = readFileSync(apiProxy, 'utf8');
  assert.match(source, /"dsh-access"/);
  assert.match(source, /"third-party"/);
});

test('optional workspace target absence does not block core patches', () => {
  const { root } = fixture('const WEB_SETTINGS_NAMESPACES = ["agent-loop"];');
  assert.equal(applyRemotePatch(root), 'applied');
  assert.equal(patchStatus(root).workspaceSearch, true);
});
