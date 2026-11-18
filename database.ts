export type Value = string | number | bigint | null;
export type Row = Record<string, Value>;
export interface Query {
  all(sql: string, ...args: Value[]): Promise<Row[]>;
  get(sql: string, ...args: Value[]): Promise<Row | undefined>;
  run(sql: string, ...args: Value[]): Promise<{ changes: number }>;
}
export interface LibraryDatabase extends Query {
  write<T>(work: (query: Query) => Promise<T>): Promise<T>;
}
