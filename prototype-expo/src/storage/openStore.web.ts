// Web preview only: browser localStorage (expo-sqlite web needs COOP/COEP headers).
import { KvStore, memoryKv, type KvBackend } from './kvStore';
import type { Store } from './types';

export const STORAGE_KIND = 'localStorage (pratinjau web)';

function browserKv(): KvBackend {
  try {
    const ls = globalThis.localStorage;
    ls.getItem('probe');
    return ls;
  } catch {
    return memoryKv();
  }
}

export async function openStore(): Promise<Store> {
  const store = new KvStore(browserKv());
  await store.init();
  return store;
}
