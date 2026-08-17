export type GatewayRole = 'admin' | 'user';
export type GatewayRequestDecision =
  | { allowed: true }
  | { allowed: false; reason: 'settings-write' | 'global-mutation' | 'unknown-mutation' };

const SAFE_RPC = new Set([
  'session.list', 'session.search', 'session.create', 'session.history', 'session.models',
  'session.selectModel', 'session.rename', 'session.fork', 'session.prompt', 'session.attachment',
  'session.updateQueue', 'session.cancel',
  'subagent.list', 'subagent.history', 'subagent.prompt', 'subagent.interrupt',
  'host.describe', 'host.listDirectory', 'host.createDirectory', 'host.openPath',
  'workspace.list', 'workspace.create', 'workspace.delete', 'workspace.archiveSession',
  'skill.list',
  'agentPreset.list', 'agentPreset.select', 'agentPreset.read',
  'goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear',
  'settings.describe',
  'llm.providers', 'llm.models',
]);

const SETTINGS_WRITES = new Set([
  'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
  'credentials.describe', 'credentials.set', 'credentials.unset',
  'llm.discoverModels',
]);

const GLOBAL_MUTATIONS = new Set([
  'workspace.rename', 'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
]);

export function classifyGatewayRequest(
  method: string,
  pathname: string,
  role: GatewayRole,
): GatewayRequestDecision {
  if (role === 'admin') return { allowed: true };
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') return { allowed: true };
  if (pathname.startsWith('/api/dsh-passwords/')) return { allowed: true };
  if (pathname.startsWith('/aionui-panel/')) return { allowed: true };
  if (!pathname.startsWith('/api/')) return { allowed: false, reason: 'unknown-mutation' };

  const rpc = pathname.slice('/api/'.length);
  if (SETTINGS_WRITES.has(rpc)) return { allowed: false, reason: 'settings-write' };
  if (GLOBAL_MUTATIONS.has(rpc)) return { allowed: false, reason: 'global-mutation' };
  if (SAFE_RPC.has(rpc)) return { allowed: true };
  return { allowed: false, reason: 'unknown-mutation' };
}
