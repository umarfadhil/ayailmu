// Native (iOS/Android): on-device SQLite.
import { openExpoSqlite } from './expoSqliteDb';
import { SqlStore } from './sqlStore';
import type { Store } from './types';

export const STORAGE_KIND = 'SQLite (perangkat)';

export async function openStore(): Promise<Store> {
  const store = new SqlStore(await openExpoSqlite('arabic-trial.db'));
  await store.init();
  return store;
}
