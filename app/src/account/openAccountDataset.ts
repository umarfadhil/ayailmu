// Native: an account dataset is its own SQLite file (accountNamespace(...).sqliteFile), beside the guest's.
import { openSqlDataset, type Namespace, type OpenedAccountDataset } from './datasets';

export async function openAccountDataset(namespace: Namespace): Promise<OpenedAccountDataset> {
  // Loaded on use, so screens that never open an account dataset never load the native SQLite module.
  const { openExpoSqlite } = await import('@/storage/expoSqliteDb');
  const opened = await openSqlDataset(await openExpoSqlite(namespace.sqliteFile), namespace);
  return { ...opened, access: 'owner', release: () => undefined };
}
