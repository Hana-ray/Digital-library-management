import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LibraryDatabase, Query } from './database.ts';

export function openLibrary(path: string): LibraryDatabase & { close(): void } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const query: Query = {
    async all(sql, ...args) { return db.prepare(sql).all(...args) as Awaited<ReturnType<Query['all']>>; },
    async get(sql, ...args) { return db.prepare(sql).get(...args) as Awaited<ReturnType<Query['get']>>; },
    async run(sql, ...args) { return { changes: Number(db.prepare(sql).run(...args).changes) }; },
  };
  let pending = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>) {
    const job = pending.then(work);
    pending = job.then(() => undefined, () => undefined);
    return job;
  }
  return {
    all: (sql, ...args) => enqueue(() => query.all(sql, ...args)),
    get: (sql, ...args) => enqueue(() => query.get(sql, ...args)),
    run: (sql, ...args) => enqueue(() => query.run(sql, ...args)),
    write(work) {
      return enqueue(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await work(query);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },
    close() { db.close(); },
  };
}
