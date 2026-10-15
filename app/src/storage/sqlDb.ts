/** Minimal async SQL surface shared by expo-sqlite (app) and node:sqlite (tests). */
export type SqlParam = string | number | null;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs fn in a transaction; rolls back and rethrows if fn throws. */
  transaction(fn: () => Promise<void>): Promise<void>;
}
