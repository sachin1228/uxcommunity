/**
 * The tiny SQL surface the offline store needs.
 *
 * Keeping it behind an interface lets the exact schema and every query run
 * under `node:sqlite` in tests, while the app uses expo-sqlite. The store never
 * imports expo-sqlite directly.
 */

export type SqlValue = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** BEGIN → fn → COMMIT, rolling back on throw. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Remove this device's database file (explicit account wipe only). */
  deleteDatabase(): Promise<void>;
}

/**
 * expo-sqlite implementation. Imported lazily by the engine so a unit test or
 * the web bundle never pulls the native module.
 */
export async function openExpoSqlDriver(name: string): Promise<SqlDriver> {
  const SQLite = await import("expo-sqlite");
  const db = await SQLite.openDatabaseAsync(name);
  return {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      await db.runAsync(sql, params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await db.getAllAsync(sql, params)) as T[];
    },
    async transaction<T>(fn: () => Promise<T>) {
      let result: T | undefined;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result as T;
    },
    async close() {
      await db.closeAsync();
    },
    async deleteDatabase() {
      await db.closeAsync().catch(() => undefined);
      await SQLite.deleteDatabaseAsync(name);
    },
  };
}
