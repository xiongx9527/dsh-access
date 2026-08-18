import { accessSync, mkdirSync, realpathSync, statSync, constants } from 'node:fs';
import path from 'node:path';

export type WorkspaceAssignmentMode = 'username' | 'specified';

export interface WorkspaceAssignmentInput {
  mode: WorkspaceAssignmentMode;
  username: string;
  baseRoot: string;
  specifiedRoot?: string | null;
}

export interface WorkspaceAssignment {
  mode: WorkspaceAssignmentMode;
  root: string;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

function existingDirectory(input: string): string {
  if (!path.isAbsolute(input)) throw new Error('workspace must be an absolute existing directory');
  let canonical: string;
  try {
    canonical = realpathSync.native(input);
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
    accessSync(canonical, constants.R_OK | constants.X_OK);
  } catch {
    throw new Error('workspace must be an accessible existing directory');
  }
  return canonical;
}

export function assignWorkspace(input: WorkspaceAssignmentInput): WorkspaceAssignment {
  if (!USERNAME_RE.test(input.username)) throw new Error('invalid username for workspace assignment');

  if (input.mode === 'specified') {
    if (typeof input.specifiedRoot !== 'string' || input.specifiedRoot.trim() === '') {
      throw new Error('specified workspace requires one existing directory');
    }
    return { mode: 'specified', root: existingDirectory(input.specifiedRoot) };
  }

  if (!path.isAbsolute(input.baseRoot)) throw new Error('workspace base root must be absolute');
  mkdirSync(input.baseRoot, { recursive: true });
  const baseRoot = existingDirectory(input.baseRoot);
  const requested = path.join(baseRoot, input.username);
  mkdirSync(requested, { recursive: true });
  const root = existingDirectory(requested);
  const relative = path.relative(baseRoot, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('username workspace escaped the configured root');
  }
  return { mode: 'username', root };
}
