// Disposable transactional test double. Live MongoDB checks are separate.
import type { Db, ClientSession } from 'mongodb';
import { randomUUID } from 'node:crypto';
type Row = Record<string, any>;
export function testDatabase() {
  const tables = new Map<string, Map<string, Row>>();
  let failAudit = false;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const equal = (a: any, b: any) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  const matches = (row: Row, query: Row): boolean =>
    Object.entries(query).every(([key, value]) => {
      if (key === '$or') return value.some((item: Row) => matches(row, item));
      if (key === '$and') return value.every((item: Row) => matches(row, item));
      if (value instanceof RegExp) return typeof row[key] === 'string' && value.test(row[key]);
      if (value && typeof value === 'object' && !(value instanceof Date))
        return Object.entries(value).every(([op, expected]: [string, any]) =>
          op === '$gt'
            ? row[key] > expected
            : op === '$gte'
              ? row[key] >= expected
              : op === '$lt'
                ? row[key] < expected
                : op === '$lte'
                  ? row[key] <= expected
                  : op === '$exists'
                    ? (row[key] !== undefined) === expected
                    : op === '$in'
                      ? expected.includes(row[key])
                      : op === '$ne'
                        ? !equal(row[key], expected)
                        : false,
        );
      return equal(row[key], value);
    });
  const duplicate = () => Object.assign(new Error('Synthetic duplicate'), { code: 11000 });
  const project = (row: Row | undefined, options?: Row) => {
    if (!row) return null;
    if (!options?.projection) return structuredClone(row);
    const positive = Object.entries(options.projection)
      .filter(([, value]) => value === 1)
      .map(([key]) => key);
    return positive.length
      ? Object.fromEntries(positive.filter((key) => key in row).map((key) => [key, row[key]]))
      : Object.fromEntries(Object.entries(row).filter(([key]) => options.projection[key] !== 0));
  };
  const fake = {
    collection(name: string) {
      return {
        async findOne(query: Row, options?: Row) {
          return project(
            [...table(name).values()].find((row) => matches(row, query)),
            options,
          );
        },
        find(query: Row, options?: Row) {
          let found = [...table(name).values()].filter((row) => matches(row, query));
          const cursor = {
            sort(order: Row) {
              found.sort((a, b) => {
                for (const [key, direction] of Object.entries(order)) {
                  if (a[key] > b[key]) return Number(direction);
                  if (a[key] < b[key]) return -Number(direction);
                }
                return 0;
              });
              return cursor;
            },
            limit(count: number) {
              found = found.slice(0, count);
              return cursor;
            },
            async toArray() {
              return found.map((row) => project(row, options));
            },
          };
          return cursor;
        },
        async insertOne(row: Row) {
          row = { ...row, _id: row._id ?? randomUUID() };
          if (name === 'audit_events' && failAudit) throw new Error('Synthetic audit outage');
          if (table(name).has(row._id)) throw duplicate();
          table(name).set(row._id, structuredClone(row));
          return { insertedId: row._id };
        },
        async updateOne(query: Row, update: Row, options: Row = {}) {
          const rows = table(name);
          let row = [...rows.values()].find((row) => matches(row, query));
          const existing = Boolean(row);
          if (!row && !options.upsert) return { matchedCount: 0, upsertedCount: 0 };
          if (!row) {
            const created: Row = {
              ...Object.fromEntries(
                Object.entries(query).filter(
                  ([key, value]) =>
                    !key.startsWith('$') &&
                    (!value || typeof value !== 'object' || value instanceof Date),
                ),
              ),
              ...structuredClone(update.$setOnInsert || {}),
            };
            created._id ??= randomUUID();
            if (rows.has(created._id)) throw duplicate();
            rows.set(created._id, created);
            row = created;
          }
          if (!row) throw new Error('Synthetic row missing');
          Object.assign(row, structuredClone(update.$set || {}));
          for (const [key, value] of Object.entries(update.$inc || {}))
            row[key] = (row[key] || 0) + Number(value);
          for (const [key, value] of Object.entries(update.$max || {}))
            if (row[key] === undefined || row[key] < value!) row[key] = value;
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
        },
        async deleteOne(query: Row) {
          const row = [...table(name).values()].find((row) => matches(row, query));
          if (row) table(name).delete(row._id);
          return { deletedCount: row ? 1 : 0 };
        },
        async deleteMany(query: Row) {
          const rows = [...table(name).values()].filter((row) => matches(row, query));
          for (const row of rows) table(name).delete(row._id);
          return { deletedCount: rows.length };
        },
      };
    },
  } as unknown as Db;
  let tail = Promise.resolve();
  const transaction = async <T>(operation: (db: Db, session: ClientSession) => Promise<T>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(tables);
    try {
      return await operation(fake, {} as ClientSession);
    } catch (error) {
      tables.clear();
      for (const [name, rows] of snapshot) tables.set(name, rows);
      throw error;
    } finally {
      release();
    }
  };
  return {
    fake,
    table,
    transaction,
    setAuditFailure: (value: boolean) => {
      failAudit = value;
    },
  };
}
