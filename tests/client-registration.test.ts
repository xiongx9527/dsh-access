import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apply } from '../src/client/index.js';
import { AccountMenu } from '../src/client/account.js';

function context(registered: Array<{ name: string; id?: string; priority?: number; order?: number }>) {
  return {
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: { name: string; id?: string; priority?: number; order?: number }) => {
        registered.push(options);
        return () => undefined;
      },
    },
    locale: { register: () => () => undefined },
    effect: (callback: () => unknown) => callback(),
  };
}

async function withFetch(response: Response, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response.clone()) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('gateway client registers the persistent sidebar account action after identity succeeds', async () => {
  await withFetch(new Response(JSON.stringify({
    ok: true, me: { id: 1, username: 'admin', role: 'admin' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const registered: Array<{ name: string; id?: string; priority?: number; order?: number }> = [];
    apply(context(registered) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(registered.some((entry) => entry.name === 'sidebar.footer.action' && entry.id === 'dsh-access-account' && entry.order === 10_000));
  });
});

test('direct 3080-style client does not register an account action when gateway identity is unavailable', async () => {
  await withFetch(new Response('not found', { status: 404 }), async () => {
    const registered: Array<{ name: string; id?: string; priority?: number; order?: number }> = [];
    apply(context(registered) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(registered.some((entry) => entry.name === 'sidebar.footer.action' && entry.id === 'dsh-access-account'), false);
    assert.equal(registered.some((entry) => entry.name === 'sidebar.settings' && entry.priority === -100), false);
  });
});

test('client plugin shadows the native settings seat only for a subuser', async () => {
  await withFetch(new Response(JSON.stringify({
    ok: true, me: { id: 2, username: 'guest', role: 'user' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const registered: Array<{ name: string; id?: string; priority?: number; order?: number }> = [];
    apply(context(registered) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(registered.some((entry) => entry.name === 'sidebar.footer.action' && entry.id === 'dsh-access-account'));
    assert.ok(registered.some((entry) => entry.name === 'sidebar.settings' && entry.priority === -100));
  });
});

test('gateway admin keeps the native settings seat while keeping the account entry', async () => {
  await withFetch(new Response(JSON.stringify({
    ok: true, me: { id: 1, username: 'admin', role: 'admin' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const registered: Array<{ name: string; id?: string; priority?: number; order?: number }> = [];
    apply(context(registered) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(registered.some((entry) => entry.name === 'sidebar.footer.action' && entry.id === 'dsh-access-account'));
    assert.equal(registered.some((entry) => entry.name === 'sidebar.settings' && entry.priority === -100), false);
  });
});

test('account trigger uses the same wide-row and circular rail class pattern as Settings', () => {
  const t = ((key: string) => key) as never;
  const wide = renderToStaticMarkup(createElement(AccountMenu, { wide: true, t } as never));
  const rail = renderToStaticMarkup(createElement(AccountMenu, { wide: false, t } as never));
  assert.match(wide, /class="dsh-access-account-trigger"/);
  assert.match(rail, /class="dsh-access-account-trigger rail"/);
  assert.match(wide, /roleAdmin|roleUser/);
});


test('account popover escapes sidebar clipping through a fixed body portal', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  const clientSource = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.match(accountSource, /createPortal\(accountPopover, document\.body\)/);
  assert.match(clientSource, /\.dsh-access-account-popover\{position:fixed;/);
});


test('logout button keeps a visible red danger style even when the host error token is absent', () => {
  const clientSource = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.match(clientSource, /\.dsh-access-account-logout\{[^}]*var\(--dsw-alias-label-error,#ef4444\)/);
  assert.match(clientSource, /\.dsh-access-account-logout:hover[^\{]*\{[^}]*rgba\(239,68,68,/);
});


test('workspace summary wraps the complete assigned path instead of truncating it', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  const clientSource = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.match(accountSource, /className: 'dsh-access-account-workspace'/);
  assert.match(clientSource, /\.dsh-access-account-summary dd\.dsh-access-account-workspace\{[^}]*overflow-wrap:anywhere/);
});


test('account center shows the compact subuser list immediately without a count-only gate', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  const clientSource = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(accountSource, /const \[usersOpen, setUsersOpen\]/);
  assert.doesNotMatch(accountSource, /'aria-expanded': usersOpen/);
  assert.match(accountSource, /h\('h3', null, t\('subusers'\)\)/);
  assert.doesNotMatch(accountSource, /`\$\{t\('subusers'\)\} \(\$\{subusers\.length\}\)`/);
  assert.match(accountSource, /className: 'dsh-access-admin-user-list'/);
  assert.match(clientSource, /\.dsh-access-admin-user-list\{[^}]*max-height:[^;}]+;[^}]*overflow:auto/);
});


test('legacy settings user rows expand one inline permission editor at a time', () => {
  const cardSource = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /const \[expandedPermissionUserId, setExpandedPermissionUserId\] = useState<number \| null>\(null\)/);
  assert.match(cardSource, /'aria-expanded': expandedPermissionUserId === u\.id/);
  assert.match(cardSource, /className: 'dsh-access-perm dsh-access-user-permission-editor'/);
  assert.match(cardSource, /const \[cardUserQuery, setCardUserQuery\] = useState\(''\)/);
});


test('modern account center uses the same one-user-at-a-time permission accordion', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  assert.match(accountSource, /const \[expandedManagedUserId, setExpandedManagedUserId\] = useState<number \| null>\(null\)/);
  assert.match(accountSource, /'aria-expanded': expandedManagedUserId === user\.id/);
  assert.match(accountSource, /className: 'dsh-access-admin-user-details'/);
  assert.match(accountSource, /className: 'dsh-access-admin-user-delete'/);
});


test('modern account user rows show the most recent login time', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  assert.match(accountSource, /className: 'dsh-access-admin-user-last-login'/);
  assert.match(accountSource, /user\.lastLoginAt \? t\('lastLogin'/);
  assert.match(accountSource, /t\('neverLoggedIn'\)/);
});


test('new subuser form defaults to workspace-write sandbox', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  assert.match(accountSource, /const EMPTY_FORM: AccountForm = \{[\s\S]*sandboxMode: 'workspace-write'/);
});

test('quota inputs have visible labels in both settings and account management', () => {
  const accountSource = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');
  const cardSource = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  for (const source of [accountSource, cardSource]) {
    assert.match(source, /className: 'dsh-access-limit-field'/);
    assert.match(source, /className: 'dsh-access-limit-label'/);
    assert.match(source, /t\('permsToken'\)/);
    assert.match(source, /t\('permsMinutes'\)/);
  }
});

test('legacy settings card uses local plugin routes for overview and permission saves', () => {
  const cardSource = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  assert.match(cardSource, /api<PermOverview>\('\/api\/dsh-access\/overview'\)/);
  assert.match(cardSource, /api\('\/api\/dsh-access\/permissions'/);
  assert.doesNotMatch(cardSource, /\/gateway\/api\/(overview|permissions)/);
  assert.match(pluginSource, /path: '\/api\/dsh-access\/overview'/);
  assert.match(pluginSource, /path: '\/api\/dsh-access\/permissions'/);
});

test('legacy settings card exposes an admin-only configurable gateway port', () => {
  const cardSource = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  assert.match(cardSource, /api<GatewayConfig>\('\/api\/dsh-access\/gateway\/config'\)/);
  assert.match(cardSource, /api(?:<GatewayConfig>)?\('\/api\/dsh-access\/gateway\/config', \{ port:/);
  assert.match(cardSource, /t\('gatewayPort'\)/);
  assert.match(cardSource, /t\('saveGatewayPort'\)/);
  assert.match(pluginSource, /path: '\/api\/dsh-access\/gateway\/config'/);
  assert.match(pluginSource, /caller\.role !== 'admin'/);
  assert.match(pluginSource, /restartGatewayAndRefreshRemote\(gatewayRuntime, remoteAccess, port\)/);
});
