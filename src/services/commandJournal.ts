import type {BackendCommand} from './apiClient';

export interface RecoverableCommand {command:BackendCommand;actorId?:string;state:'sending'|'outcome_unknown';savedAt:string}
const dbName='mazao-v1-command-journal';const storeName='commands';
let database:Promise<IDBDatabase>|null=null;
function openDatabase(){
 if(typeof indexedDB==='undefined')return Promise.reject(new Error('This browser cannot safely retain command recovery data.'));
 if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName,{keyPath:'command.commandId'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('Could not open the command journal.'));request.onblocked=()=>reject(new Error('Command journal upgrade is blocked by another open tab.'))});
 // A blocked/failed open must be retryable after the browser problem is fixed.
 // Keep every existing record; only forget this failed connection attempt.
 const attempt=database;
 void attempt.catch(()=>{if(database===attempt)database=null;});
 return attempt;
}
function run<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore,setResult:(value:T)=>void,reject:(reason:unknown)=>void)=>void){return openDatabase().then(db=>new Promise<T>((resolve,reject)=>{const tx=db.transaction(storeName,mode);let result:T;operation(tx.objectStore(storeName),value=>{result=value},reject);tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error??new Error('Command journal transaction failed.'));tx.onerror=()=>reject(tx.error??new Error('Command journal transaction failed.'))}))}
export const commandJournal={
 save(command:BackendCommand,state:RecoverableCommand['state'],actorId?:string){return run<void>('readwrite',(store,resolve,reject)=>{const request=store.put({command,...(actorId?{actorId}:{}),state,savedAt:new Date().toISOString()} satisfies RecoverableCommand);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})},
 remove(commandId:string){return run<void>('readwrite',(store,resolve,reject)=>{const request=store.delete(commandId);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})},
 list(tenantId?:string){return run<RecoverableCommand[]>('readonly',(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve((request.result as RecoverableCommand[]).filter(record=>!tenantId||record.command.tenantId===tenantId));request.onerror=()=>reject(request.error)})},
};
