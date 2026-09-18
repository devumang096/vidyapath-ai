// Feature logic is written as pure functions that return WriteOps. The Cloud Function applies
// them inside a transaction; the browser demo applies the same ops to its in-memory store.

export type WriteOp =
  | { path: string; data: Record<string, unknown>; merge?: boolean }
  | { path: string; delete: true };

export interface Clock {
  /** Wall-clock time the operation is evaluated at. */
  now: Date;
  /** IST calendar date (YYYY-MM-DD) for streak and activity bookkeeping. */
  today: string;
  /** Timestamp sentinel or value to store in createdAt/updatedAt fields. */
  stamp: unknown;
  /** Fresh document id for notifications and other server-generated docs. */
  newId: () => string;
}

export interface WriteSink {
  set(path: string, data: Record<string, unknown>, merge: boolean): void;
  delete(path: string): void;
}

export function applyWrites(sink: WriteSink, ops: WriteOp[]): void {
  for (const op of ops) {
    if ("delete" in op) sink.delete(op.path);
    else sink.set(op.path, op.data, op.merge === true);
  }
}
