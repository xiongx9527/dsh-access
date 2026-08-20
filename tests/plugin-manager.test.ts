import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mutatePluginManifest } from '../src/plugin-manager.js';

test('plugin manifest mutations keep dependency and bundle state aligned', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-plugin-manifest-'));
  const file = path.join(dir, 'package.json');
  writeFileSync(file, JSON.stringify({
    dependencies: { 'dsh-access': 'link:/tmp/dsh-access' },
    dsh: { profile: { bundles: ['dsh-access'] } },
  }));

  mutatePluginManifest(file, { action: 'install', packageName: '@example/test-plugin', spec: 'npm:@example/test-plugin@1.0.0' });
  let manifest = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(manifest.dependencies['@example/test-plugin'], 'npm:@example/test-plugin@1.0.0');
  assert.deepEqual(manifest.dsh.profile.bundles, ['dsh-access', '@example/test-plugin']);

  mutatePluginManifest(file, { action: 'disable', packageName: '@example/test-plugin' });
  manifest = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['dsh-access']);

  mutatePluginManifest(file, { action: 'enable', packageName: '@example/test-plugin' });
  mutatePluginManifest(file, { action: 'remove', packageName: '@example/test-plugin' });
  manifest = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(manifest.dependencies['@example/test-plugin'], undefined);
  assert.deepEqual(manifest.dsh.profile.bundles, ['dsh-access']);
});

test('plugin manifest mutations reject unsafe package names', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-plugin-manifest-'));
  const file = path.join(dir, 'package.json');
  writeFileSync(file, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
  assert.throws(() => mutatePluginManifest(file, { action: 'install', packageName: '../../escape', spec: 'file:../../escape' }), /invalid plugin package/);
});
