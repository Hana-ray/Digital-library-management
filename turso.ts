import { createClient } from '@libsql/client/web';
import type { LibraryDatabase, Query, Row, Value } from './database.ts';

export function connectTurso(url: string, authToken: string): LibraryDatabase {
  const client = createClient({ url, authToken });
  function query(executor: Pick<typeof client, 'execute'>): Query {
    const execute = (sql: string, args: Value[]) => executor.execute({ sql, args });
    return {
      async all(sql, ...args) { return (await execute(sql, args)).rows as Row[]; },
      async get(sql, ...args) { return (await execute(sql, args)).rows[0] as Row | undefined; },
      async run(sql, ...args) { return { changes: (await execute(sql, args)).rowsAffected }; },
    };
  }
  return {
    ...query(client),
    async write(work) {
      const tx = await client.transaction('write');
      try {
        const result = await work(query(tx));
        await tx.commit();
        return result;
      } finally {
        tx.close();
      }
    },
  };
}
