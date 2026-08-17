import test from 'node:test';
import assert from 'node:assert/strict';
import { folderAllowed } from '../src/permissions.js';

test('empty folder assignment denies a restricted subuser instead of allowing every path', () => {
  assert.equal(folderAllowed('/srv/projects/secret', []), false);
});

test('URL-encoded parent traversal cannot remain inside the authorized prefix', () => {
  assert.equal(folderAllowed('/srv/workspaces/alice/%2e%2e/admin', ['/srv/workspaces/alice']), false);
});

test('similar path prefixes are not treated as children of the authorized root', () => {
  assert.equal(folderAllowed('/srv/workspaces/alice-private/file.txt', ['/srv/workspaces/alice']), false);
});

test('a normalized child path remains allowed', () => {
  assert.equal(folderAllowed('/srv/workspaces/alice/project/file.txt', ['/srv/workspaces/alice']), true);
});
