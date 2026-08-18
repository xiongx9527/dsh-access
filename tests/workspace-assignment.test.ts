import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadAssignments() {
  const loaded = await import('../src/workspace-assignment.js').catch(() => null);
  assert.ok(loaded, 'workspace-assignment module must exist');
  return loaded;
}

test('username mode creates and returns the canonical username directory', async () => {
  const assignments = await loadAssignments();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-workspaces-'));
  const result = assignments.assignWorkspace({ mode: 'username', username: 'alice', baseRoot: temp });

  assert.deepEqual(result, {
    mode: 'username',
    root: realpathSync(path.join(temp, 'alice')),
  });
  assert.equal(existsSync(path.join(temp, 'alice')), true);
});

test('specified mode accepts exactly one existing accessible directory', async () => {
  const assignments = await loadAssignments();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-specified-'));
  const selected = path.join(temp, 'project');
  mkdirSync(selected);

  assert.deepEqual(
    assignments.assignWorkspace({ mode: 'specified', username: 'alice', baseRoot: temp, specifiedRoot: selected }),
    { mode: 'specified', root: realpathSync(selected) },
  );
});

test('specified mode rejects a missing directory instead of changing permissions', async () => {
  const assignments = await loadAssignments();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-missing-'));
  assert.throws(
    () => assignments.assignWorkspace({
      mode: 'specified',
      username: 'alice',
      baseRoot: temp,
      specifiedRoot: path.join(temp, 'missing'),
    }),
    /existing directory/i,
  );
});

test('username mode rejects invalid usernames before creating directories', async () => {
  const assignments = await loadAssignments();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dshpw-invalid-user-'));
  assert.throws(
    () => assignments.assignWorkspace({ mode: 'username', username: '../admin', baseRoot: temp }),
    /username/i,
  );
  assert.equal(existsSync(path.join(temp, 'admin')), false);
});
