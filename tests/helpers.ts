import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db.js';
import { createFieldCrypto } from '../src/encrypt.js';
import type { PlatformConfig } from '../src/config.js';
import { AuthService } from '../src/auth.js';

export function testConfig(dbPath: string): PlatformConfig {
  return {
    setupKey: 'test-setup-key',
    dbPath,
    dbEncKey: '',
    workspaceRoot: path.join(path.dirname(dbPath), 'workspaces'),
    gateway: {
      host: '127.0.0.1',
      port: 0,
      upstream: 'http://127.0.0.1:3080',
      tls: null,
      redirectPort: null,
      publicHost: '',
      domain: '',
      autoTls: false,
      acmeEmail: '',
      acmeStaging: false,
    },
    jwtSecret: 'test-jwt-secret-that-is-long-enough',
    internalSecret: 'test-internal-secret',
    patch: { dshRoot: '', restartService: '' },
  };
}

export function createAuthFixture(): { db: Database; auth: AuthService; config: PlatformConfig } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-auth-'));
  const config = testConfig(path.join(dir, 'platform.db'));
  const db = new Database(config.dbPath, createFieldCrypto(config.dbEncKey, config.setupKey));
  db.init();
  return { db, auth: new AuthService(config, db), config };
}
