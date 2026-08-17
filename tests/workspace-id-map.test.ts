import test from 'node:test';
import assert from 'node:assert/strict';
import { collectIdPathPairs } from '../src/permissions.js';

test('workspace list workspaceId values map to their canonical paths', () => {
  const mapped = collectIdPathPairs({
    result: { value: { items: [
      { workspaceId: 'workspace-guest', path: '/srv/workspaces/guest' },
    ] } },
  });
  assert.equal(mapped.get('workspace-guest'), '/srv/workspaces/guest');
});
