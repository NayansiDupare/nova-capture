import { describe, expect, it } from 'vitest';

import { openDatabase } from './open-database';
import { inTransaction } from './transaction';

const setup = () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE t (v TEXT)');
  const insert = (v: string) => db.prepare('INSERT INTO t (v) VALUES (?)').run(v);
  const values = () =>
    db
      .prepare('SELECT v FROM t ORDER BY v')
      .all()
      .map((r) => r['v']);
  return { db, insert, values };
};

describe('inTransaction', () => {
  it('commits when the function returns, and passes its result through', () => {
    const { db, insert, values } = setup();
    expect(inTransaction(db, () => (insert('a'), 42))).toBe(42);
    expect(values()).toEqual(['a']);
    expect(db.isTransaction).toBe(false);
  });

  it('rolls back when the function throws', () => {
    const { db, insert, values } = setup();
    expect(() =>
      inTransaction(db, () => {
        insert('a');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(values()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it('joins an outer transaction, so a failure after the inner call undoes both', () => {
    const { db, insert, values } = setup();
    expect(() =>
      inTransaction(db, () => {
        inTransaction(db, () => insert('inner'));
        insert('outer');
        throw new Error('later step failed');
      }),
    ).toThrow('later step failed');
    expect(values()).toEqual([]);
  });

  it('commits nested writes with the outer transaction', () => {
    const { db, insert, values } = setup();
    inTransaction(db, () => {
      inTransaction(db, () => insert('inner'));
      insert('outer');
    });
    expect(values()).toEqual(['inner', 'outer']);
  });
});
