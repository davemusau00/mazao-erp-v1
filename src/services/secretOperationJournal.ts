export interface SecretOperationRecovery {
  tenantId:string;actorId:string;commandId:string;kind:'staff.password.set'|'auth.password.change';
  targetUserId:string;expectedCredentialVersion:number;state:'sending'|'outcome_unknown';savedAt:string;
}
const databaseName='mazao-v1-secret-operations';const storeName='operations';
let database:Promise<IDBDatabase>|null=null;
function openDatabase():Promise<IDBDatabase>{
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'commandId'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Password operation recovery could not be opened.'));
    request.onblocked=()=>reject(new Error('Close other Mazao tabs before opening password recovery.'));
  });
  return database;
}
async function run<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore,finish:(value:T)=>void)=>void):Promise<T>{
  const db=await openDatabase();return new Promise<T>((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);let result:T;
    operation(transaction.objectStore(storeName),value=>{result=value;});
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(new Error('Password operation recovery could not be saved.'));
    transaction.onabort=()=>reject(new Error('Password operation recovery could not be saved.'));
  });
}
export const secretOperationJournal={
  save(record:SecretOperationRecovery):Promise<void>{
    // Explicit projection prevents request bodies, credentials and fingerprints entering IndexedDB.
    const safe:SecretOperationRecovery={tenantId:record.tenantId,actorId:record.actorId,commandId:record.commandId,kind:record.kind,targetUserId:record.targetUserId,expectedCredentialVersion:record.expectedCredentialVersion,state:record.state,savedAt:record.savedAt};
    return run<void>('readwrite',(store,finish)=>{store.put(safe).onsuccess=()=>finish(undefined);});
  },
  remove(commandId:string):Promise<void>{return run<void>('readwrite',(store,finish)=>{store.delete(commandId).onsuccess=()=>finish(undefined);});},
  list(tenantId:string,actorId:string):Promise<SecretOperationRecovery[]>{return run<SecretOperationRecovery[]>('readonly',(store,finish)=>{const request=store.getAll();request.onsuccess=()=>finish((request.result as SecretOperationRecovery[]).filter(record=>record.tenantId===tenantId&&record.actorId===actorId));});},
};
