import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export type PathAuthorizationResult =
  | { allowed: true; path: string }
  | { allowed: false; reason: 'invalid-path' | 'missing-path' | 'outside-root' };

function decodePath(input: string): string | null {
  let value = input;
  try {
    for (let i = 0; i < 4; i += 1) {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    }
  } catch {
    return null;
  }
  if (value.includes('\0')) return null;
  return value;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolve a requested path against a canonical workspace root.
 * Existing targets use their own realpath; missing targets use the nearest
 * existing parent's realpath so a symlink cannot escape before creation.
 */
export function authorizeFilesystemPath(
  rootInput: string,
  candidateInput: string,
  options: { allowMissing?: boolean } = {},
): PathAuthorizationResult {
  const decodedRoot = decodePath(rootInput);
  const decodedCandidate = decodePath(candidateInput);
  if (decodedRoot === null || decodedCandidate === null) return { allowed: false, reason: 'invalid-path' };
  if (!path.isAbsolute(decodedRoot) || !path.isAbsolute(decodedCandidate)) {
    return { allowed: false, reason: 'invalid-path' };
  }

  let root: string;
  try {
    root = realpathSync.native(decodedRoot);
  } catch {
    return { allowed: false, reason: 'missing-path' };
  }

  const normalizedCandidate = path.resolve(decodedCandidate);
  let target: string;
  if (existsSync(normalizedCandidate)) {
    try {
      target = realpathSync.native(normalizedCandidate);
    } catch {
      return { allowed: false, reason: 'missing-path' };
    }
  } else {
    if (options.allowMissing !== true) return { allowed: false, reason: 'missing-path' };
    const missingSegments: string[] = [];
    let parent = normalizedCandidate;
    while (!existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) return { allowed: false, reason: 'missing-path' };
      missingSegments.unshift(path.basename(parent));
      parent = next;
    }
    try {
      const realParent = realpathSync.native(parent);
      target = path.resolve(realParent, ...missingSegments);
    } catch {
      return { allowed: false, reason: 'missing-path' };
    }
  }

  if (!inside(root, target)) return { allowed: false, reason: 'outside-root' };
  return { allowed: true, path: target };
}
