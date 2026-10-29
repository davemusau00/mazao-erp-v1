export interface LocalCountDraftLine {
  productId: string;
  countedQuantity: string | null;
  varianceReason: string | null;
}

export interface LocalCountDraft {
  key: string;
  tenantId: string;
  actorId: string;
  outletId: string;
  countId: string;
  countVersion: number;
  revision: number;
  updatedAt: string;
  lines: LocalCountDraftLine[];
}

export interface CountDraftScope {
  tenantId: string;
  actorId: string;
  outletId: string;
  countId: string;
}

export class CountDraftConflictError extends Error {
  constructor(readonly current: LocalCountDraft | null) {
    super('This count draft changed in another tab. Review the latest local edits before continuing.');
    this.name = 'CountDraftConflictError';
  }
}

const databaseName = 'mazao-v1-count-drafts';
const storeName = 'drafts';
const maximumLines = 20_000;
const maximumBytes = 5 * 1024 * 1024;
let database: Promise<IDBDatabase> | null = null;

export function countDraftKey(scope: CountDraftScope): string {
  return [scope.tenantId, scope.actorId, scope.outletId, scope.countId].map(value => encodeURIComponent(value)).join(':');
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot safely retain unsent count edits.'));
  if (!database) database = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = null; };
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (!settled) { settled = true; reject(request.error ?? new Error('Could not open local count recovery storage.')); }
    };
    request.onblocked = () => {
      if (!settled) { settled = true; reject(new Error('Local count recovery storage is blocked by another open tab. Close older Mazao tabs and retry.')); }
    };
  });
  const attempt = database;
  void attempt.catch(() => { if (database === attempt) database = null; });
  return attempt;
}

function validateDraft(draft: LocalCountDraft): void {
  if (!draft.key || !draft.tenantId || !draft.actorId || !draft.outletId || !draft.countId
    || !Number.isSafeInteger(draft.countVersion) || draft.countVersion < 1
    || !Number.isSafeInteger(draft.revision) || draft.revision < 1
    || typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))
    || !Array.isArray(draft.lines) || draft.lines.length > maximumLines) {
    throw new Error('Local count recovery data is invalid and was not restored.');
  }
  const productIds = new Set<string>();
  for (const line of draft.lines) {
    if (!line || typeof line.productId !== 'string' || line.productId.length > 128
      || productIds.has(line.productId)
      || !(line.countedQuantity === null || (typeof line.countedQuantity === 'string' && line.countedQuantity.length <= 32))
      || !(line.varianceReason === null || (typeof line.varianceReason === 'string' && line.varianceReason.length <= 200))) {
      throw new Error('Local count recovery data is invalid and was not restored.');
    }
    productIds.add(line.productId);
  }
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > maximumBytes) {
    throw new Error('These count edits exceed the browser recovery storage limit. They remain on screen; save the count draft to the server before leaving.');
  }
}

function checked(value: unknown, scope: CountDraftScope): LocalCountDraft | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Local count recovery data is invalid and was not restored.');
  const draft = value as LocalCountDraft;
  validateDraft(draft);
  if (draft.key !== countDraftKey(scope) || draft.tenantId !== scope.tenantId || draft.actorId !== scope.actorId
    || draft.outletId !== scope.outletId || draft.countId !== scope.countId) {
    throw new Error('Local count recovery data belongs to a different account, outlet or count and was not restored.');
  }
  return draft;
}

function transaction<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: unknown) => void) => void): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    let result: T;
    let failure: unknown;
    let settled = false;
    let tx: IDBTransaction;
    try { tx = db.transaction(storeName, mode); }
    catch (error) { reject(error); return; }
    const fail = (reason: unknown) => { failure = reason; try { tx.abort(); } catch { if (!settled) { settled = true; reject(reason); } } };
    execute(tx.objectStore(storeName), value => { result = value; }, fail);
    tx.oncomplete = () => { if (!settled) { settled = true; resolve(result!); } };
    tx.onabort = () => { if (!settled) { settled = true; reject(failure ?? tx.error ?? new Error('Local count recovery storage could not commit the draft.')); } };
    tx.onerror = () => { if (!failure) failure = tx.error ?? new Error('Local count recovery storage failed.'); };
  }));
}

export const countDraftStore = {
  listForScope(scope: Omit<CountDraftScope, 'countId'>): Promise<LocalCountDraft[]> {
    return transaction('readonly', (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const matching = (request.result as LocalCountDraft[]).filter(draft => draft?.tenantId === scope.tenantId
            && draft?.actorId === scope.actorId && draft?.outletId === scope.outletId);
          resolve(matching.map(draft => checked(draft, { ...scope, countId: draft.countId })!));
        } catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  },

  get(scope: CountDraftScope): Promise<LocalCountDraft | null> {
    const key = countDraftKey(scope);
    return transaction('readonly', (store, resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => { try { resolve(checked(request.result, scope)); } catch (error) { reject(error); } };
      request.onerror = () => reject(request.error);
    });
  },

  save(scope: CountDraftScope, countVersion: number, lines: LocalCountDraftLine[], expectedRevision: number | null): Promise<LocalCountDraft> {
    const key = countDraftKey(scope);
    return transaction('readwrite', (store, resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const current = checked(request.result, scope);
          if ((current?.revision ?? null) !== expectedRevision) { reject(new CountDraftConflictError(current)); return; }
          const next: LocalCountDraft = {
            ...scope, key, countVersion, revision: (current?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString(),
            lines: lines.map(line => ({ productId: line.productId, countedQuantity: line.countedQuantity, varianceReason: line.varianceReason })),
          };
          validateDraft(next);
          const write = store.put(next);
          write.onsuccess = () => resolve(next);
          write.onerror = () => reject(write.error);
        } catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  },

  remove(scope: CountDraftScope, expectedRevision: number | null): Promise<boolean> {
    const key = countDraftKey(scope);
    return transaction('readwrite', (store, resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const current = checked(request.result, scope);
          if (!current) { resolve(true); return; }
          if (current.revision !== expectedRevision) { reject(new CountDraftConflictError(current)); return; }
          const deletion = store.delete(key);
          deletion.onsuccess = () => resolve(true);
          deletion.onerror = () => reject(deletion.error);
        } catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  },
};
