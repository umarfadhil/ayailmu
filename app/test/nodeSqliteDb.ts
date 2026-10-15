// Test-only SqlDb adapter over Node's built-in SQLite, so the real SqlStore SQL runs in Jest.
import { createRequire } from 'module';

import type { SqlDb, SqlParam } from '../src/storage/sqlDb';

// Loaded at runtime so Metro never sees node:sqlite.
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');

export interface NodeSqliteDb extends SqlDb {
  raw: InstanceType<typeof DatabaseSync>;
  close(): void;
}

export function openNodeSqlite(file: string, hooks: { beforeRun?: (sql: string) => void } = {}): NodeSqliteDb {
  const raw = new DatabaseSync(file);
  return {
    raw,
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params: SqlParam[] = []) {
      hooks.beforeRun?.(sql);
      raw.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: SqlParam[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      raw.close();
    },
  };
}
