import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewaySaveViewState } from '../src/client/card.js';
import { restartGatewayAndRefreshRemote } from '../src/plugin.js';

test('gateway save state always selects remote and increments exactly once', () => {
  assert.deepEqual(gatewaySaveViewState(0), { activeTab: 'remote', refreshKey: 1 });
  assert.deepEqual(gatewaySaveViewState(7), { activeTab: 'remote', refreshKey: 8 });
});

test('port integration stops the old tunnel, confirms restart, then refreshes remote port', async () => {
  const events: string[] = [];
  await restartGatewayAndRefreshRemote(
    { restart: async (port) => { events.push(`restart:${port}`); } },
    {
      stopTunnel: async () => { events.push('stop'); },
      setGatewayPort: async (port) => { events.push(`remote:${port}`); },
    },
    4090,
  );
  assert.deepEqual(events, ['stop', 'restart:4090', 'remote:4090']);
});

test('failed gateway restart never publishes the draft port to remote state', async () => {
  const events: string[] = [];
  await assert.rejects(
    restartGatewayAndRefreshRemote(
      { restart: async () => { events.push('restart'); throw new Error('busy'); } },
      {
        stopTunnel: async () => { events.push('stop'); },
        setGatewayPort: async (port) => { events.push(`remote:${port}`); },
      },
      4090,
    ),
    /busy/,
  );
  assert.deepEqual(events, ['stop', 'restart']);
});
