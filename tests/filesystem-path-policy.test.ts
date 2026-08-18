import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadPolicy() {
  const loaded = await import('../src/path-policy.js').catch(() => null);
  assert.ok(loaded, 'path-policy module must exist');
  return loaded;
}

test('existing file through a symlink that escapes the workspace root is denied', async () => {
  const policy = await loadPolicy();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-path-'));
  const root = path.join(temp, 'root');
  const outside = path.join(temp, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, path.join(root, 'escape'));

  const result = policy.authorizeFilesystemPath(root, path.join(root, 'escape', 'secret.txt'));
  assert.deepEqual(result, { allowed: false, reason: 'outside-root' });
});

test('new target uses the nearest existing parent realpath and rejects a symlink escape', async () => {
  const policy = await loadPolicy();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-new-path-'));
  const root = path.join(temp, 'root');
  const outside = path.join(temp, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, 'escape'));

  const result = policy.authorizeFilesystemPath(root, path.join(root, 'escape', 'new', 'file.txt'), {
    allowMissing: true,
  });
  assert.deepEqual(result, { allowed: false, reason: 'outside-root' });
});

test('a missing child below the real workspace root is authorized without creating it', async () => {
  const policy = await loadPolicy();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-child-path-'));
  const root = path.join(temp, 'root');
  mkdirSync(root);

  const target = path.join(root, 'new', 'file.txt');
  const result = policy.authorizeFilesystemPath(root, target, { allowMissing: true });
  assert.equal(result.allowed, true);
  assert.equal(result.path, path.join(realpathSync(root), 'new', 'file.txt'));
});

test('encoded traversal and paths outside the root are denied before execution', async () => {
  const policy = await loadPolicy();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-encoded-path-'));
  const root = path.join(temp, 'root');
  mkdirSync(root);

  assert.equal(
    policy.authorizeFilesystemPath(root, `${root}/%2e%2e/outside`, { allowMissing: true }).allowed,
    false,
  );
  assert.equal(
    policy.authorizeFilesystemPath(root, path.join(temp, 'outside'), { allowMissing: true }).allowed,
    false,
  );
});
