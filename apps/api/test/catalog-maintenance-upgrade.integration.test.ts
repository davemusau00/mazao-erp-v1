import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { test } from 'node:test';

const sourceUrl=process.env.TEST_DATABASE_URL;
if(!sourceUrl){test('catalog migration preserves legacy identities and posted evidence',{skip:'Requires disposable TEST_DATABASE_URL with CREATE DATABASE permission.'},()=>{});}
else{
  test('catalog migration 023 backfills exact labels, reruns, and rolls back ambiguous legacy identity preflight',{timeout:180_000},async t=>{
    async function fixture(run:(client:Client,migrate:(target?:string,accepted?:boolean)=>string)=>Promise<void>){
      const name='mazao_catalog_upgrade_'+randomUUID().replaceAll('-',''),maintenance=new URL(sourceUrl!),database=new URL(sourceUrl!);maintenance.pathname='/postgres';database.pathname='/'+name;
      const admin=new Client({connectionString:maintenance.href});let client:Client|undefined,created=false;
      const migrate=(target?:string,accepted=true)=>{
        const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/migration.ts',import.meta.url))],{cwd:process.cwd(),encoding:'utf8',timeout:120_000,env:{...process.env,DATABASE_URL:database.href,MIGRATION_TARGET:target??''}});
        assert.ifError(result.error);const output=result.stdout+'\n'+result.stderr;
        if(accepted)assert.equal(result.status,0,output);else assert.notEqual(result.status,0,'preflight must fail without applying 023');return output;
      };
      try{await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;migrate('022_credential_operation_fencing');client=new Client({connectionString:database.href});await client.connect();await run(client,migrate);}
      finally{await client?.end();try{if(created)await admin.query(`DROP DATABASE "${name}"`);}finally{await admin.end();}}
    }
    async function seed(client:Client){
      const tenant=randomUUID(),outlet=randomUUID(),operator=randomUUID(),device=randomUUID(),product=randomUUID(),shift=randomUUID(),order=randomUUID(),receiptCommand=randomUUID(),saleCommand=randomUUID();
      await client.query('BEGIN');
      try{
        await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Legacy catalog business','KES','Africa/Nairobi')",[tenant]);
        await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Legacy catalog outlet','Africa/Nairobi')",[outlet,tenant]);
        await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'non-login-test-fixture','Legacy catalog operator')",[operator,operator+'@example.invalid']);
        await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenant,operator]);
        await client.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Legacy catalog assignment')",[device,tenant,outlet,operator]);
        const add=async(sku:string,category:string,active=true)=>{const id=sku==='LEGACY-PAID'?product:randomUUID();await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,category,active) VALUES($1,$2,$3,$4,$5,'each','KES',500,400,0,$6,$7)",[id,tenant,outlet,sku,'Original '+sku,category,active]);await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,$4,$5)',[tenant,outlet,id,id===product?1:0,id===product?400:0]);return id;};
        await add('LEGACY-PAID','Milk');await add('LEGACY-LOWER','milk');await add('LEGACY-ARCHIVED','Milk',false);await add('LEGACY-UNCATEGORIZED','');
        await client.query("INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,counted_cash_minor,variance_minor,closed_at) VALUES($1,$2,$3,$4,'CLOSED',0,500,500,500,0,now())",[shift,tenant,outlet,operator]);
        await client.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,receipt_profile_snapshot)
          VALUES($1,$2,$3,$4,$5,'KES',500,0,500,'CONFIRMED',$6,'Original business snapshot','Original outlet snapshot','Africa/Nairobi',500,0,'{"receiptFooter":"Unchanged receipt"}'::jsonb)`,[order,tenant,outlet,shift,operator,'MZ-'+order.replaceAll('-','').toUpperCase()]);
        await client.query("INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,cogs_minor) VALUES($1,$2,$3,$4,$5,'LEGACY-PAID','Original paid item',1,500,400,0,500,0,400)",[randomUUID(),tenant,outlet,order,product]);
        await client.query("INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status) VALUES($1,$2,$3,$4,'CASH',500,'KES','CONFIRMED')",[randomUUID(),tenant,outlet,order]);
        await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
          VALUES($1,$2,$3,$4,$5,'RECEIPT',2,400,800,NULL),($6,$2,$3,$4,$7,'SALE',-1,400,400,$8)`,[randomUUID(),tenant,outlet,product,receiptCommand,randomUUID(),saleCommand,order]);
        for(const entry of [{type:'INVENTORY_RECEIPT',source:receiptCommand,debit:'INVENTORY',credit:'GOODS_RECEIVED_NOT_INVOICED',amount:800},{type:'SALE',source:order,debit:'CASH_TILL',credit:'SALES_REVENUE',amount:500},{type:'SALE_COGS',source:order,debit:'COST_OF_GOODS_SOLD',credit:'INVENTORY',amount:400}]){
          const id=randomUUID();await client.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,$3,$4,'KES',$5)",[id,tenant,entry.type,entry.source,operator]);
          await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,0),($6,$2,$3,$7,0,$5)',[randomUUID(),tenant,id,entry.debit,entry.amount,randomUUID(),entry.credit]);
        }
        await client.query('COMMIT');return {tenant,outlet,operator,product};
      }catch(error){await client.query('ROLLBACK');throw error;}
    }
    async function snapshot(client:Client){
      const tables=['catalog.products','inventory.balances','inventory.movements','commerce.orders','commerce.order_lines','commerce.payments','commerce.shifts','finance.journal_entries','finance.journal_lines','system.commands'];
      const result:Record<string,unknown>={};
      for(const table of tables){
        // Compare every original column; later additive columns have separate
        // migration-specific assertions in item-kinds-upgrade.integration.
        const expression=table==='catalog.products'?"to_jsonb(x)-'category_id'-'item_kind'":table==='commerce.order_lines'?"to_jsonb(x)-'item_kind_snapshot'":table==='system.commands'?"to_jsonb(x)-'authority_version'-'required_capabilities'":'to_jsonb(x)';
        result[table]=(await client.query(`SELECT ${expression} evidence FROM ${table} x ORDER BY (${expression})::text`)).rows;
      }
      return result;
    }
    await t.test('populated upgrade and rerun preserve paid snapshots/stock/journals and exact category case',async()=>fixture(async(client,migrate)=>{
      const data=await seed(client),before=await snapshot(client);migrate();migrate();assert.deepEqual(await snapshot(client),before);
      const categories=(await client.query('SELECT name FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2',[data.tenant,data.outlet])).rows.map(row=>row.name);assert.deepEqual(categories.sort(),['Milk','milk'],'both exact labels survive independently of database collation order');
      const links=await client.query('SELECT p.category,p.category_id,c.name FROM catalog.products p LEFT JOIN catalog.categories c ON c.tenant_id=p.tenant_id AND c.outlet_id=p.outlet_id AND c.id=p.category_id WHERE p.tenant_id=$1',[data.tenant]);
      for(const row of links.rows){assert.equal(row.category_id===null,row.category==='');if(row.category)assert.equal(row.category,row.name);}
      const count=await client.query("SELECT count(*)::int n FROM system.schema_migrations WHERE version='023_catalog_maintenance'");assert.equal(count.rows[0].n,1);
      await assert.rejects(client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,'legacy-archived','Forbidden identity reuse','each','KES',500,400,0)",[randomUUID(),data.tenant,data.outlet]),{code:'23505'});
      const otherOutlet=randomUUID();await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other scoped outlet','Africa/Nairobi')",[otherOutlet,data.tenant]);
      await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,'LEGACY-PAID','Different outlet identity','each','KES',500,400,0)",[randomUUID(),data.tenant,otherOutlet]);
    }));
    await t.test('case-insensitive collision including archived identity fails before DDL without silent merge',async()=>fixture(async(client,migrate)=>{
      const data=await seed(client);await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,active) VALUES($1,$2,$3,'legacy-paid','Ambiguous archived identity','each','KES',500,400,0,false)",[randomUUID(),data.tenant,data.outlet]);
      const before=await snapshot(client),output=migrate(undefined,false);assert.match(output,/SKU ambiguity requires reviewed identity repair/);assert.deepEqual(await snapshot(client),before);
      assert.equal((await client.query("SELECT to_regclass('catalog.categories') relation")).rows[0].relation,null);assert.equal((await client.query("SELECT count(*)::int n FROM system.schema_migrations WHERE version='023_catalog_maintenance'")).rows[0].n,0);
    }));
    await t.test('legacy category text needing normalization fails without rewriting labels or financial evidence',async()=>fixture(async(client,migrate)=>{
      const data=await seed(client);await client.query("UPDATE catalog.products SET category=' Milk ' WHERE id=$1",[data.product]);
      const before=await snapshot(client),output=migrate(undefined,false);assert.match(output,/category labels require review/);assert.deepEqual(await snapshot(client),before);assert.equal((await client.query("SELECT to_regclass('catalog.categories') relation")).rows[0].relation,null);
    }));
  });
}
