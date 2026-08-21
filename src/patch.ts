// 远程设置补丁：强制启用。
//
// 背景：dsh 把 settings 等特权面设计成 loopback-only——
//   1. 客户端（dsh-client-ui-settings/lib/client.js）：
//      connection.isLoopback ? "host" : "memory" → 远程浏览器走 memory 模式，
//      设置表单不可用
//   2. 主机侧（dsh-host-apiproxy/lib/index.js）：
//      WEB_SETTINGS_NAMESPACES 硬编码白名单，第三方插件命名空间不在其中
// 网关把 Host/Origin 改写为 127.0.0.1:3080，主机侧栅栏对经网关的流量放行，
// 所以只需把客户端持久化强制为 host 模式 + 把插件命名空间加进白名单。
//
// 信任边界：只有通过访问管理登录的浏览器能写设置（直连 3080 的局域网浏览器
// 仍会被主机侧栅栏拒绝）。无论本地直连还是远程，强制打此补丁影响都不大，
// 因此不提供开关：网关每次启动自动应用（幂等），dsh 升级覆盖文件后重启
// 网关自动重打，或在设置页点"重载补丁"。
import { readFileSync, writeFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const BAK_SUFFIX = '.bak-dshaccess';

/** 客户端设置持久化文件（强制 host 模式） */
const SETTINGS_TARGET = path.join(
  'node_modules', '@deepseek-ai', 'dsh-client-ui-settings', 'lib', 'client.js',
);
/** 主机侧 settings 白名单文件（补插件命名空间） */
const WHITELIST_TARGET = path.join(
  'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js',
);
/** Workspace session rows: let blank New Session rows expose Archive. */
const WORKSPACE_CLIENT_TARGET = path.join(
  'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js',
);

const SETTINGS_FROM = 'connection.isLoopback ? "host" : "memory"';
const SETTINGS_TO = '"host"';
const SEARCH_STICKY_RE =
  /(searchInput\.current\?\.blur\(\);)[\t ]*\n[\t ]*(if \(normalizedQuery !== ""\) return;)[\t ]*\n[\t ]*(setSearchExpanded\(false\);)/;
const SEARCH_STICKY_TO =
  '$1\n\t\t\t\t\tif (normalizedQuery === "") {\n\t\t\t\t\t\tsetSearchExpanded(false);\n\t\t\t\t\t} else if (remoteSearch.status !== "loading" && remoteSearch.items.length === 0) {\n\t\t\t\t\t\tsetQuery("");\n\t\t\t\t\t\tsetSearchExpanded(false);\n\t\t\t\t\t}';
const SEARCH_DEPS_RE =
  /(\}, \[)[\t ]*\n[\t ]*normalizedQuery,[\t ]*\n[\t ]*wide,[\t ]*\n[\t ]*searchExpanded([\t ]*\n[\t ]*\]\);)/;
const SEARCH_DEPS_TO = '$1\n\t\t\t\tremoteSearch,\n\t\t\t\tnormalizedQuery,\n\t\t\t\twide,\n\t\t\t\tsearchExpanded$2';
const SEARCH_AUTOFILL_MARK = 'dsh-access-session-search';
const SEARCH_AUTOFILL_RE =
  /(className: WorkspaceBrowser_module_css_default\.searchInput,[\t ]*\n[\t ]*type: "text",)/;
const SEARCH_AUTOFILL_TO =
  '$1\n\t\t\t\t\t\t\tautoComplete: "off",\n\t\t\t\t\t\t\tname: "dsh-access-session-search",';

function whitelistPatchApplicable(content: string): boolean {
  return /WEB_SETTINGS_NAMESPACES\s*=/.test(content);
}

function hasPatchTargets(installRoot: string): boolean {
  return (
    existsSync(path.join(installRoot, SETTINGS_TARGET)) &&
    existsSync(path.join(installRoot, WHITELIST_TARGET))
  );
}

/** Resolve either an install prefix, package root, node_modules directory or executable to the shared install prefix. */
function installationRootFrom(start: string): string | null {
  if (!start || !existsSync(start)) return null;
  let current: string;
  try {
    current = realpathSync(start);
    if (statSync(current).isFile()) current = path.dirname(current);
  } catch {
    return null;
  }
  for (;;) {
    if (hasPatchTargets(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 找到承载 DSH 及其 hoisted 依赖的安装前缀，找不到返回 null。 */
export function findDshRoot(explicit: string, entrypoint = process.argv[1] ?? ''): string | null {
  if (explicit) return installationRootFrom(explicit);

  const running = installationRootFrom(entrypoint);
  if (running) return running;

  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const globalInstall = installationRootFrom(globalRoot);
    if (globalInstall) return globalInstall;
  } catch {
    // npm 不可用时走兜底路径
  }

  for (const candidate of ['/opt/homebrew/lib', '/usr/local/lib', '/usr/lib']) {
    const install = installationRootFrom(candidate);
    if (install) return install;
  }
  return null;
}

/** 补丁当前状态（用于 status 展示） */
export function patchStatus(dshRoot: string): { settingsHostMode: boolean; whitelist: boolean; workspaceSearch: boolean } {
  const settingsFile = path.join(dshRoot, SETTINGS_TARGET);
  const wlFile = path.join(dshRoot, WHITELIST_TARGET);
  const workspaceFile = path.join(dshRoot, WORKSPACE_CLIENT_TARGET);
  let settingsHostMode = false;
  let whitelist = false;
  let workspaceSearch = !existsSync(workspaceFile);
  try {
    const s = readFileSync(settingsFile, 'utf8');
    settingsHostMode = !s.includes(SETTINGS_FROM) && s.includes(SETTINGS_TO);
  } catch { /* 文件缺失按未打处理 */ }
  try {
    const w = readFileSync(wlFile, 'utf8');
    whitelist = !whitelistPatchApplicable(w) || /['"]dsh-access['"]/.test(w);
  } catch { /* 同上 */ }
  try {
    const workspace = readFileSync(workspaceFile, 'utf8');
    workspaceSearch =
      (!workspace.includes('if (normalizedQuery !== "") return;') || !SEARCH_STICKY_RE.test(workspace)) &&
      (workspace.includes(SEARCH_AUTOFILL_MARK) || !SEARCH_AUTOFILL_RE.test(workspace));
  } catch { /* 可选目标缺失视为已满足 */ }
  return { settingsHostMode, whitelist, workspaceSearch };
}

/** 应用补丁（幂等）：返回 'applied'（本次有改动）或 'unchanged' 或 'missing'（目标文件不在） */
export function applyRemotePatch(dshRoot: string): 'applied' | 'unchanged' | 'missing' {
  const settingsFile = path.join(dshRoot, SETTINGS_TARGET);
  const wlFile = path.join(dshRoot, WHITELIST_TARGET);
  if (!existsSync(settingsFile) || !existsSync(wlFile)) return 'missing';
  let changed = false;

  // 1) 客户端 settings 强制 host 模式
  const s = readFileSync(settingsFile, 'utf8');
  if (s.includes(SETTINGS_FROM)) {
    if (!existsSync(settingsFile + BAK_SUFFIX)) writeFileSync(settingsFile + BAK_SUFFIX, s);
    writeFileSync(settingsFile, s.replace(SETTINGS_FROM, SETTINGS_TO));
    changed = true;
  }

  // 2) rc.6 白名单只追加本插件；rc.7 已移除白名单，原生满足。
  const w = readFileSync(wlFile, 'utf8');
  if (whitelistPatchApplicable(w) && !/['"]dsh-access['"]/.test(w)) {
    const re = /const WEB_SETTINGS_NAMESPACES = \[([\s\S]*?)\];/;
    const match = w.match(re);
    if (!match) return 'missing';
    if (!existsSync(wlFile + BAK_SUFFIX)) writeFileSync(wlFile + BAK_SUFFIX, w);
    const separator = match[1].trim() === '' ? '\n\t' : `${match[1].trimEnd()},\n\t`;
    writeFileSync(wlFile, w.replace(re, `const WEB_SETTINGS_NAMESPACES = [${separator}"dsh-access"\n];`));
    changed = true;
  }

  // 3) 可选 workspace 客户端补丁：搜索体验 + 空白会话归档。
  const workspaceClientFile = path.join(dshRoot, WORKSPACE_CLIENT_TARGET);
  if (existsSync(workspaceClientFile)) {
    const source = readFileSync(workspaceClientFile, 'utf8');
    let patched = source;
    if (SEARCH_STICKY_RE.test(patched) && SEARCH_DEPS_RE.test(patched)) {
      patched = patched.replace(SEARCH_STICKY_RE, SEARCH_STICKY_TO).replace(SEARCH_DEPS_RE, SEARCH_DEPS_TO);
    }
    if (!patched.includes(SEARCH_AUTOFILL_MARK) && SEARCH_AUTOFILL_RE.test(patched)) {
      patched = patched.replace(SEARCH_AUTOFILL_RE, SEARCH_AUTOFILL_TO);
    }
    const archiveItems = 'items: row.blank ? sessionMenuItems.filter((item) => item.id === "archive") : sessionMenuItems,';
    if (!patched.includes(archiveItems)) {
      const actionGuard = /!row\.blank && \(0, react_jsx_runtime\.jsx\)\("span", \{(\s*className: Rows_module_css_default\.rowActions,)/;
      if (actionGuard.test(patched) && patched.includes('items: sessionMenuItems,')) {
        patched = patched
          .replace(actionGuard, '(0, react_jsx_runtime.jsx)("span", {$1')
          .replace('items: sessionMenuItems,', archiveItems);
      }
    }
    if (patched !== source) {
      if (!existsSync(workspaceClientFile + BAK_SUFFIX)) writeFileSync(workspaceClientFile + BAK_SUFFIX, source);
      writeFileSync(workspaceClientFile, patched);
      changed = true;
    }
  }

  return changed ? 'applied' : 'unchanged';
}

/**
 * 回滚补丁：从 .bak-dshaccess 备份恢复两个目标文件。
 * 备份不存在（从未打过补丁）时返回 'no-backup'。
 */
export function rollbackPatch(dshRoot: string): 'rolled-back' | 'no-backup' | 'missing' {
  const settingsFile = path.join(dshRoot, SETTINGS_TARGET);
  const wlFile = path.join(dshRoot, WHITELIST_TARGET);
  if (!existsSync(settingsFile) || !existsSync(wlFile)) return 'missing';
  let changed = false;
  for (const target of [settingsFile, wlFile]) {
    const bak = target + BAK_SUFFIX;
    if (existsSync(bak)) {
      writeFileSync(target, readFileSync(bak));
      changed = true;
    }
  }
  return changed ? 'rolled-back' : 'no-backup';
}

/** 延迟重启 dsh 网页服务（补丁生效需要 dsh 重新加载模块）；仅适用于常驻进程 */
export function restartDshWeb(service: string, delayMs = 2500): void {
  if (!service) return;
  setTimeout(() => {
    try {
      execSync(`systemctl restart ${service}`, { stdio: 'ignore' });
    } catch (error) {
      console.error(`[dsh-access] 重启 ${service} 失败（补丁将在下次 dsh 重启后生效）:`, error);
    }
  }, delayMs).unref();
}
