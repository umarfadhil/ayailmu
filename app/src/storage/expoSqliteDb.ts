import * as SQLite from 'expo-sqlite';

import type { SqlDb, SqlParam } from './sqlDb';

export async function openExpoSqlite(name: string): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParam[] = []) => {
      await db.runAsync(sql, params);
    },
    all: <T>(sql: string, params: SqlParam[] = []) => db.getAllAsync<T>(sql, params),
    // Writes are already serialized by SqlStore, so the non-exclusive transaction is safe here.
    transaction: (fn) => db.withTransactionAsync(fn),
  };
}
