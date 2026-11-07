import fs from 'fs';
import os from 'os';
import path from 'path';
import {openAdapterDatabase, type AdapterDatabase} from './sqliteAdapter';

// Qariah (TECH_DEBT #317): make the folder on first use; resetDatabases() removes it.
let currentDir: string | null = null;
// A folder from useDatabaseDir() stays with the caller.
let ownsCurrentDir = false;
const open = new Map<string, AdapterDatabase>();

export function databaseDir(): string {
  if (currentDir === null) {
    currentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-sqlite-'));
    ownsCurrentDir = true;
  }
  return currentDir;
}

// Closes every open handle but keeps the current directory, so a fresh set of
// service instances can reopen the same files (simulates an app relaunch).
export async function closeOpenDatabases(): Promise<void> {
  for (const db of open.values()) await db.closeAsync();
  open.clear();
}

export function useDatabaseDir(dir: string): void {
  currentDir = dir;
  ownsCurrentDir = false;
}

// Called in beforeEach for isolation; closes handles and starts a new directory.
export async function resetDatabases(): Promise<void> {
  for (const db of open.values()) await db.closeAsync();
  open.clear();
  if (currentDir !== null && ownsCurrentDir) {
    fs.rmSync(currentDir, {recursive: true, force: true});
  }
  currentDir = null;
  ownsCurrentDir = false;
}

export const expoSqliteModule = {
  openDatabaseAsync: async (name: string): Promise<AdapterDatabase> => {
    const existing = open.get(name);
    if (existing) return existing;
    const db = openAdapterDatabase(path.join(databaseDir(), name));
    // Real expo-sqlite opens a fresh connection after closeAsync(), so drop
    // the cached handle when a service closes it.
    const close = db.closeAsync.bind(db);
    db.closeAsync = async (): Promise<void> => {
      if (open.get(name) === db) open.delete(name);
      await close();
    };
    open.set(name, db);
    return db;
  },
};

export const openDatabaseAsync = expoSqliteModule.openDatabaseAsync;
