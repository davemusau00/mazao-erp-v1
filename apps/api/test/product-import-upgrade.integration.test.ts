import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const sourceUrl=process.env.TEST_DATABASE_URL;
const migrationCount=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>/^\d{3}_.+\.sql$/.test(name)).length;
if(!sourceUrl){
  test('product import upgrade preserves migration-014 business evidence',{skip:'Set TEST_DATABASE_URL to a disposable PostgreSQL database with CREATE DATABASE permission.'},()=>{});
}else{
  test('additive import migration preserves existing stock, movement, journal and receipt snapshots and reruns safely',async()=>{
    const databaseName='mazao_import_upgrade_'+randomUUID().replaceAll('-','');
    const maintenanceUrl=new URL(sourceUrl);maintenanceUrl.pathname='/postgres';
    const admin=new Client({connectionString:maintenanceUrl.href});const databaseUrl=new URL(sourceUrl);databaseUrl.pathname='/'+databaseName;
    let created=false;let fixture:Client|undefined;
    const migrate=(target?:string)=>{
      const migration=fileURLToPath(new URL('../src/migration.ts',import.meta.url));
      const run=spawnSync(process.execPath,['--import','tsx',migration],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,DATABASE_URL:databaseUrl.href,MIGRATION_TARGET:target??''}});
      assert.ifError(run.error);assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
    };
    try{
      await admin.connect();
      await admin.query(`CREATE DATABASE "${databaseName}"`);created=true;
      migrate('014_configuration');fixture=new Client({connectionString:databaseUrl.href});await fixture.connect();
      const tenant=randomUUID(),outlet=randomUUID(),user=randomUUID(),device=randomUUID(),product=randomUUID(),shift=randomUUID(),order=randomUUID(),receiptCommand=randomUUID(),saleCommand=randomUUID();
      await fixture.query('BEGIN');
      await fixture.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,\'Legacy resort\',\'KES\',\'Africa/Nairobi\')',[tenant]);
      await fixture.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,\'Legacy outlet\',\'Africa/Nairobi\')',[outlet,tenant]);
      await fixture.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,\'fixture-only-invalid-hash\',\'Legacy operator\')',[user,'legacy-'+user+'@example.invalid']);
      await fixture.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'admin\')',[tenant,user]);
      await fixture.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,\'Legacy assignment\')',[device,tenant,outlet,user]);
      await fixture.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at)
        VALUES($1,$2,$3,$4,'staff.password.set',$5,'REJECTED','{"status":"REJECTED","code":"VERSION_CONFLICT"}'::jsonb,now())`,[tenant,randomUUID(),user,device,Buffer.from('legacy-nonreplayable-fingerprint')]);
      await fixture.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
        VALUES($1,$2,$3,'LEGACY-001','Legacy item','each','KES',250,100,1600)`,[product,tenant,outlet]);
      await fixture.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,1,100)',[tenant,outlet,product]);
      await fixture.query(`INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,counted_cash_minor,variance_minor,closed_at)
        VALUES($1,$2,$3,$4,'CLOSED',0,290,290,290,0,now())`,[shift,tenant,outlet,user]);
      await fixture.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,receipt_profile_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',250,40,290,'CONFIRMED',$6,'Original receipt business','Original receipt outlet','Africa/Nairobi',290,0,'{"receiptFooter":"Immutable legacy footer"}'::jsonb)`,[order,tenant,outlet,shift,user,'MZ-'+order.replaceAll('-','').toUpperCase()]);
      await fixture.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
        VALUES($1,$2,$3,$4,$5,'RECEIPT',2,100,200,NULL),($6,$2,$3,$4,$7,'SALE',-1,100,100,$8)`,[randomUUID(),tenant,outlet,product,receiptCommand,randomUUID(),saleCommand,order]);
      const entry=randomUUID();
      await fixture.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,\'INVENTORY_RECEIPT\',$3,\'KES\',$4)',[entry,tenant,receiptCommand,user]);
      await fixture.query(`INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor)
        VALUES($1,$2,$3,'INVENTORY',200,0),($4,$2,$3,'GOODS_RECEIVED_NOT_INVOICED',0,200)`,[randomUUID(),tenant,entry,randomUUID()]);
      await fixture.query('COMMIT');
      const snapshot=async()=>{
        const balances=await fixture!.query('SELECT * FROM inventory.balances ORDER BY product_id');
        // Migration 026 adds an ordinal for count evidence. Compare every
        // original movement field here; its new sequence receives its own
        // migration-upgrade assertions in count-recovery-upgrade.integration.
        const movements=await fixture!.query("SELECT to_jsonb(m)-'movement_seq' AS prior_evidence FROM inventory.movements m ORDER BY id");
        const journals=await fixture!.query('SELECT id,tenant_id,source_type,source_id,currency,created_by,posted_at FROM finance.journal_entries ORDER BY id');
        const lines=await fixture!.query('SELECT * FROM finance.journal_lines ORDER BY id');
        // Migration 016 adds this one new display snapshot. Compare every
        // pre-existing order column byte-for-byte while checking the new
        // snapshot separately below.
        const receipts=await fixture!.query("SELECT to_jsonb(o)-'operator_name_snapshot' AS prior_evidence FROM commerce.orders o ORDER BY id");
        const products=await fixture!.query('SELECT id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,active,version FROM catalog.products ORDER BY id');
        const commands=await fixture!.query("SELECT to_jsonb(c)-'authority_version'-'required_capabilities' AS prior_evidence FROM system.commands c ORDER BY tenant_id,command_id");
        return {balances:balances.rows,movements:movements.rows,journals:journals.rows,lines:lines.rows,receipts:receipts.rows,products:products.rows,commands:commands.rows};
      };
      const before=await snapshot();
      migrate();migrate();
      assert.deepEqual(await snapshot(),before,'Migration and rerun must not rewrite existing posted or inventory evidence.');
      assert.equal((await fixture.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1 AND effective_date IS NOT NULL',[tenant])).rows[0].n,0,'the additive business-date field must not rewrite historical journal dates');
      assert.equal((await fixture.query('SELECT operator_name_snapshot FROM commerce.orders WHERE id=$1',[order])).rows[0].operator_name_snapshot,'Legacy operator','the additive historical operator snapshot must come from the original global identity and remain stable on rerun.');
      const metadata=await fixture.query('SELECT category,barcode,reorder_level::text,last_import_batch_id FROM catalog.products WHERE id=$1',[product]);
      assert.deepEqual(metadata.rows[0],{category:'',barcode:null,reorder_level:'0.000000',last_import_batch_id:null});
      assert.equal((await fixture.query('SELECT count(*)::int total FROM catalog.product_import_batches')).rows[0].total,0);
      assert.equal((await fixture.query('SELECT count(*)::int total FROM system.credential_operations')).rows[0].total,0,'upgrade leaves pre-existing credential commands unchanged without inventing metadata');
      assert.equal((await fixture.query('SELECT count(*)::int total FROM system.schema_migrations')).rows[0].total,migrationCount,'the complete additive upgrade reaches the current migration');
    }finally{
      try{
        // Client.end waits for the socket to close. Pool.end can resolve while
        // idle sockets are still closing; a forced database drop races those
        // sockets and emits an uncaught administrator-termination error.
        await fixture?.end();
        if(created)await admin.query(`DROP DATABASE "${databaseName}"`);
      }finally{await admin.end();}
    }
  });
}
