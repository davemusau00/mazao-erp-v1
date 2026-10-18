import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';

if(!process.env.TEST_DATABASE_URL){test('versioned account names preserve economic classifications and posted evidence',{skip:'Set TEST_DATABASE_URL to disposable PostgreSQL.'},()=>{});}
else{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.APP_ORIGINS='http://localhost:3000';
  const [{pool},{buildApp},{hashPassword}]=await Promise.all([import('../src/db.js'),import('../src/app.js'),import('../src/security.js')]);
  after(async()=>{await pool.end();});
  test('account name commands are authorized, versioned, replay-safe and leave historical money unchanged',async()=>{
    const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID(),email=`catalog-${userId}@example.invalid`;
    await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,\'Account labels\',\'KES\',\'UTC\')',[tenantId]);
    await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,\'Counter\',\'Africa/Nairobi\')',[outletId,tenantId]);
    await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,\'Accounting reviewer\')',[userId,email,await hashPassword('disposable-account-label-password')]);
    await pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'accountant\')',[tenantId,userId]);
    await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,\'Accounting device\')',[deviceId,tenantId,outletId,userId]);
    const entryId=randomUUID(),client=await pool.connect();
    try{await client.query('BEGIN');await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,\'SALE\',$3,\'KES\',$4)',[entryId,tenantId,randomUUID(),userId]);await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,\'CASH_TILL\',100,0),($4,$2,$3,\'SALES_REVENUE\',0,100)',[randomUUID(),tenantId,entryId,randomUUID()]);await client.query('COMMIT');}finally{client.release();}
    const fingerprint=async()=>JSON.stringify((await pool.query('SELECT (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM finance.journal_entries e WHERE tenant_id=$1) entries,(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE tenant_id=$1) lines',[tenantId])).rows[0]);
    const before=await fingerprint(),app=buildApp();await app.ready();
    try{
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'disposable-account-label-password'},headers:{'x-forwarded-for':'198.51.100.212'}});assert.equal(login.statusCode,200,login.body);
      const cookies=login.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((part):part is string=>typeof part==='string').map(part=>part.split(';')[0]).join('; ');
      const headers={cookie,origin:'http://localhost:3000','x-csrf-token':login.json().csrfToken};
      const initial=await app.inject({url:'/api/v1/reports/account-catalog',headers});assert.equal(initial.statusCode,200,initial.body);assert.equal(initial.json().version,1);
      const command=(label:string,version:number,payload:Record<string,unknown>={accountCode:'SALES_REVENUE',label})=>({protocolVersion:1,commandId:randomUUID(),deviceId,type:'finance.account.label',occurredAt:new Date().toISOString(),expectedVersions:{[`account-catalog:${tenantId}`]:version},payload});
      const first=command('Counter turnover',1),submit=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/v1/commands',headers,payload});
      const renamed=await submit(first);assert.equal(renamed.json().status,'CONFIRMED',renamed.body);assert.deepEqual((await submit(first)).json(),renamed.json());
      const catalog=(await app.inject({url:'/api/v1/reports/account-catalog',headers})).json();assert.equal(catalog.version,2);assert.equal(catalog.accounts.find((row:{accountCode:string})=>row.accountCode==='SALES_REVENUE').label,'Counter turnover');assert.equal(catalog.accounts.find((row:{accountCode:string})=>row.accountCode==='SALES_REVENUE').classification,'REVENUE');
      const report=(await app.inject({url:`/api/v1/reports/trial-balance?asOf=${new Date().toISOString().slice(0,10)}`,headers})).json();assert.equal(report.accountCatalogVersion,2);assert.equal(report.accounts.find((row:{accountCode:string})=>row.accountCode==='SALES_REVENUE').accountName,'Counter turnover');
      const invalid=await submit(command('Invalid',2,{accountCode:'SALES_REVENUE',label:'Revenue',classification:'ASSET'}));assert.equal(invalid.json().status,'REJECTED');
      const unknown=await submit(command('Invalid',2,{accountCode:'NEW_UNCONTROLLED_ACCOUNT',label:'Unsupported'}));assert.equal(unknown.json().status,'REJECTED');
      const raced=await Promise.all(['Counter revenue','Retail revenue'].map(label=>submit(command(label,2))));assert.deepEqual(raced.map(result=>result.json().status).sort(),['CONFIRMED','CONFLICT']);
      assert.equal(await fingerprint(),before,'renaming never rewrites entries, account identity, classifications or historical amounts');
      assert.equal((await pool.query('SELECT count(*)::text n FROM finance.account_label_revisions WHERE tenant_id=$1',[tenantId])).rows[0].n,'2');
      const cashierSession={...login.json(),user:{...login.json().user,role:'cashier'}};void cashierSession;
      await pool.query('UPDATE identity.memberships SET role=\'cashier\' WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
      const rejected=await submit(command('Cashier edit',3));assert.equal(rejected.json().status,'REJECTED');assert.equal(rejected.json().code,'FORBIDDEN');
    }finally{await app.close();}
  });
}
