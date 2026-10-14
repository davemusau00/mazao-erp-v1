export interface ImportValidationRecovery {
  commandId:string;type:'catalog.import.validate'|'catalog.import.revalidate';tenantId:string;deviceId:string;actorId:string;
  fileName:string;sourceHash:string;state:'sending'|'outcome_unknown';savedAt:string;
}
const databaseName='mazao-v1-import-validations';
const storeName='operations';
let database:Promise<IDBDatabase>|null=null;
function openDatabase():Promise<IDBDatabase>{
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'commandId'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Import recovery metadata could not be opened.'));
    request.onblocked=()=>reject(new Error('Close other Mazao tabs before opening import recovery.'));
  });
  return database;
}
async function run<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore,setResult:(value:T)=>void)=>void):Promise<T>{
  const db=await openDatabase();
  return new Promise<T>((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);let result:T;
    operation(transaction.objectStore(storeName),value=>{result=value;});
    transaction.oncomplete=()=>resolve(result);
    transaction.onabort=()=>reject(new Error('Import recovery metadata could not be saved.'));
    transaction.onerror=()=>reject(new Error('Import recovery metadata could not be saved.'));
  });
}
export const importValidationJournal={
  save(record:ImportValidationRecovery):Promise<void>{
    // Pick every permitted field explicitly. CSV source and mapping never enter this store.
    const safe:ImportValidationRecovery={commandId:record.commandId,type:record.type,tenantId:record.tenantId,deviceId:record.deviceId,actorId:record.actorId,fileName:record.fileName,sourceHash:record.sourceHash,state:record.state,savedAt:record.savedAt};
    return run<void>('readwrite',(store,setResult)=>{store.put(safe).onsuccess=()=>setResult(undefined);});
  },
  remove(commandId:string):Promise<void>{return run<void>('readwrite',(store,setResult)=>{store.delete(commandId).onsuccess=()=>setResult(undefined);});},
  list(tenantId:string,deviceId:string,actorId:string):Promise<ImportValidationRecovery[]>{
    return run<ImportValidationRecovery[]>('readonly',(store,setResult)=>{const request=store.getAll();request.onsuccess=()=>setResult((request.result as ImportValidationRecovery[]).filter(record=>record.tenantId===tenantId&&record.deviceId===deviceId&&record.actorId===actorId));});
  },
};
