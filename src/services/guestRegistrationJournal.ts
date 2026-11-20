import type { GuestRegistrationOperation } from '../../apps/api/src/guestRegistrationTypes';

/** Only a descriptor is durable. Guest names, contacts and document values stay out. */
export interface GuestRegistrationRecovery extends GuestRegistrationOperation {
  tenantId: string;
  actorId: string;
  deviceId: string;
  outletId: string;
  state: 'sending' | 'outcome_unknown';
  savedAt: string;
}

const databaseName = 'mazao-v1-guest-registration-operations';
const storeName = 'operations';
let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Guest registration recovery needs browser storage.'));
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'commandId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Guest registration recovery could not be opened.'));
    request.onblocked = () => reject(new Error('Close other Mazao tabs before opening guest registration recovery.'));
  });
  const attempt = database;
  void attempt.catch(() => { if (database === attempt) database = null; });
  return attempt;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, complete: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let value: T;
    action(transaction.objectStore(storeName), result => { value = result; });
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(new Error('Guest registration recovery could not be saved.'));
    transaction.onabort = () => reject(new Error('Guest registration recovery could not be saved.'));
  });
}

export const guestRegistrationJournal = {
  save(record: GuestRegistrationRecovery): Promise<void> {
    const safe: GuestRegistrationRecovery = {
      protocolVersion: 1, commandId: record.commandId, registrationId: record.registrationId,
      expectedVersion: record.expectedVersion, kind: record.kind,
      scope: { tenantId: record.tenantId, actorId: record.actorId, outletId: record.outletId, deviceId: record.deviceId },
      ...(record.reservationId ? { reservationId: record.reservationId } : {}),
      ...(record.expectedReservationVersion !== undefined ? { expectedReservationVersion: record.expectedReservationVersion } : {}),
      tenantId: record.tenantId, actorId: record.actorId, deviceId: record.deviceId,
      outletId: record.outletId, state: record.state, savedAt: record.savedAt,
    };
    return run<void>('readwrite', (store, complete) => { store.put(safe).onsuccess = () => complete(undefined); });
  },
  remove(commandId: string): Promise<void> {
    return run<void>('readwrite', (store, complete) => { store.delete(commandId).onsuccess = () => complete(undefined); });
  },
  list(tenantId: string, actorId: string, outletId: string): Promise<GuestRegistrationRecovery[]> {
    return run<GuestRegistrationRecovery[]>('readonly', (store, complete) => {
      const request = store.getAll();
      request.onsuccess = () => complete((request.result as GuestRegistrationRecovery[]).filter(record =>
        record.tenantId === tenantId && record.actorId === actorId && record.outletId === outletId));
    });
  },
};
