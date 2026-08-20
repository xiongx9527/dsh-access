import { readFileSync, writeFileSync } from 'node:fs';

export type PluginManifestAction = 'install' | 'remove' | 'enable' | 'disable';

export interface PluginManifestMutation {
  action: PluginManifestAction;
  packageName: string;
  spec?: string;
}

const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

function assertPackageName(name: string): void {
  if (!PACKAGE_NAME_RE.test(name) || name.includes('..')) throw new Error('invalid plugin package name');
}

function loadManifest(file: string): Record<string, any> {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
  parsed.dependencies = parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {};
  parsed.dsh = parsed.dsh && typeof parsed.dsh === 'object' ? parsed.dsh : {};
  parsed.dsh.profile = parsed.dsh.profile && typeof parsed.dsh.profile === 'object' ? parsed.dsh.profile : {};
  parsed.dsh.profile.bundles = Array.isArray(parsed.dsh.profile.bundles) ? parsed.dsh.profile.bundles : [];
  return parsed;
}

export function mutatePluginManifest(file: string, mutation: PluginManifestMutation): void {
  assertPackageName(mutation.packageName);
  const manifest = loadManifest(file);
  const dependencies = manifest.dependencies as Record<string, string>;
  const bundles = manifest.dsh.profile.bundles as string[];
  const index = bundles.indexOf(mutation.packageName);

  if (mutation.action === 'install') {
    const spec = typeof mutation.spec === 'string' && mutation.spec.trim() !== '' ? mutation.spec.trim() : mutation.packageName;
    if (/\s|[;&|`$]/.test(spec)) throw new Error('invalid plugin package spec');
    dependencies[mutation.packageName] = spec;
    if (index < 0) bundles.push(mutation.packageName);
  } else if (mutation.action === 'remove') {
    delete dependencies[mutation.packageName];
    if (index >= 0) bundles.splice(index, 1);
  } else if (mutation.action === 'enable') {
    if (!dependencies[mutation.packageName]) throw new Error('plugin is not installed');
    if (index < 0) bundles.push(mutation.packageName);
  } else if (index >= 0) {
    bundles.splice(index, 1);
  }

  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}
