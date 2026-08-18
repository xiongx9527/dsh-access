import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findDshRoot, patchStatus, applyRemotePatch } from '../src/patch.js';
import { readFileSync } from 'node:fs';

function fixture(t: test.TestContext) {
  const prefix = mkdtempSync(path.join(os.tmpdir(), 'dshpw-patch-root-'));
  t.after(() => rmSync(prefix, { recursive: true, force: true }));
  const dshPackage = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh');
  const entrypoint = path.join(dshPackage, 'lib', 'bin.js');
  const settings = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings', 'lib', 'client.js');
  const whitelist = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js');
  const workspaceClient = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js');
  mkdirSync(path.dirname(entrypoint), { recursive: true });
  mkdirSync(path.dirname(settings), { recursive: true });
  mkdirSync(path.dirname(whitelist), { recursive: true });
  mkdirSync(path.dirname(workspaceClient), { recursive: true });
  writeFileSync(entrypoint, '');
  writeFileSync(settings, 'const mode = connection.isLoopback ? "host" : "memory";');
  writeFileSync(whitelist, 'const WEB_SETTINGS_NAMESPACES = ["agent-loop"];');
  writeFileSync(workspaceClient, `
!row.blank && (0, react_jsx_runtime.jsx)("span", {
  className: Rows_module_css_default.rowActions,
  children: (0, react_jsx_runtime.jsx)(Menu, {
    items: sessionMenuItems,
  })
})`);
  return { prefix, dshPackage, entrypoint, workspaceClient };
}

test('findDshRoot discovers an npx-style hoisted installation from the running DSH entrypoint', (t) => {
  const f = fixture(t);
  assert.equal(findDshRoot('', f.entrypoint), realpathSync(f.prefix));
  assert.equal(findDshRoot(f.dshPackage, ''), realpathSync(f.prefix));
});

test('the discovered installation root produces a real patch status and can be patched idempotently', (t) => {
  const f = fixture(t);
  const root = findDshRoot('', f.entrypoint);
  assert.equal(root, realpathSync(f.prefix));
  assert.deepEqual(patchStatus(root!), { settingsHostMode: false, whitelist: false });
  assert.equal(applyRemotePatch(root!), 'applied');
  assert.deepEqual(patchStatus(root!), { settingsHostMode: true, whitelist: true });
  const workspaceSource = readFileSync(f.workspaceClient, 'utf8');
  assert.doesNotMatch(workspaceSource, /!row\.blank && .*rowActions/s);
  assert.match(workspaceSource, /items: row\.blank \? sessionMenuItems\.filter\(\(item\) => item\.id === "archive"\) : sessionMenuItems/);
  assert.equal(applyRemotePatch(root!), 'unchanged');
});


test('the DSH host passes its discovered install prefix to the gateway child', () => {
  const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  assert.match(pluginSource, /const detectedDshRoot = findDshRoot\(cfg\.patch\.dshRoot\)/);
  assert.match(pluginSource, /MCP_DSH_ROOT: detectedDshRoot/);
});
