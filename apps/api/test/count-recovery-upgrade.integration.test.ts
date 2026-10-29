import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {test} from 'node:test';

const sourceUrl=process.env.TEST_DATABASE_URL;
if(!sourceUrl){
  test('count recovery upgrade preserves surviving evidence and fences incompatible writers',{skip:'Requires disposable localhost TEST_DATABASE_URL with CREATE DATABASE permission.'},()=>{});
}else{
  test('populated 025 to 026 upgrade preserves stock finance and original counting evidence',{timeout:180_000},async t=>{
    const source=new URL(sourceUrl);
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(source.hostname));
    const name='mazao_count_upgrade_'+randomUUID().replaceAll('-','');
    const maintenance=new URL(source);maintenance.pathname='/postgres';
    const database=new URL(source);database.pathname='/'+name;
    const admin=new Client({connectionString:maintenance.href});
    let client:Client|undefined,created=false;
    const migrate=(target='')=>{
      const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/migration.ts',import.meta.url))],{
        cwd:process.cwd(),encoding:'utf8',timeout:60_000,
        env:{...process.env,DATABASE_URL:database.href,MIGRATION_TARGET:target},
      });
      assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return result.stdout;
    };
    try{
      await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
      migrate('025_command_capability_evidence');
      client=new Client({connectionString:database.href});await client.connect();
      const tenant=randomUUID(),outlet=randomUUID(),operator=randomUUID(),device=randomUUID();
      const foreignTenant=randomUUID(),foreignOutlet=randomUUID(),foreignUser=randomUUID(),foreignProduct=randomUUID();
      const product=randomUUID(),extraProduct=randomUUID(),shift=randomUUID(),order=randomUUID();
      const receiptCommand=randomUUID(),saleCommand=randomUUID(),attemptCommand=randomUUID();
      const counts={OPEN:randomUUID(),POSTED:randomUUID(),CANCELLED:randomUUID()};
      await client.query('BEGIN');
      await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Count upgrade business','KES','Africa/Nairobi')",[tenant]);
      await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Count upgrade outlet','Africa/Nairobi')",[outlet,tenant]);
      await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'fixture-invalid-hash','Original count operator')",[operator,operator+'@example.invalid']);
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenant,operator]);
      await client.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Count upgrade assignment')",[device,tenant,outlet,operator]);
      await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Foreign upgrade business','KES','Africa/Nairobi')",[foreignTenant]);
      await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Foreign upgrade outlet','Africa/Nairobi')",[foreignOutlet,foreignTenant]);
      await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'fixture-invalid-hash','Foreign count operator')",[foreignUser,foreignUser+'@example.invalid']);
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[foreignTenant,foreignUser]);
      await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,'FOREIGN-COUNT','Foreign item','each','KES',500,400,0)",[foreignProduct,foreignTenant,foreignOutlet]);
      await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,0,0)',[foreignTenant,foreignOutlet,foreignProduct]);
      for(const [id,sku,quantity,value] of [[product,'COUNT-UPGRADE',8,3200],[extraProduct,'COUNT-EXTRA',0,0]] as const){
        await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,$4,$4,'each','KES',500,400,0)",[id,tenant,outlet,sku]);
        await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,$4,$5)',[tenant,outlet,id,quantity,value]);
      }
      await client.query("INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,counted_cash_minor,variance_minor,closed_at) VALUES($1,$2,$3,$4,'CLOSED',0,1000,1000,1000,0,now())",[shift,tenant,outlet,operator]);
      await client.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,receipt_profile_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',1000,0,1000,'CONFIRMED',$6,'Original receipt business','Original receipt outlet','Africa/Nairobi',1000,0,'{"receiptFooter":"Before count recovery"}'::jsonb)`,[order,tenant,outlet,shift,operator,'MZ-'+order.replaceAll('-','').toUpperCase()]);
      await client.query("INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,cogs_minor) VALUES($1,$2,$3,$4,$5,'COUNT-UPGRADE','Original sold item',2,500,400,0,1000,0,800)",[randomUUID(),tenant,outlet,order,product]);
      await client.query("INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status) VALUES($1,$2,$3,$4,'CASH',1000,'KES','CONFIRMED')",[randomUUID(),tenant,outlet,order]);
      await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
        VALUES($1,$2,$3,$4,$5,'RECEIPT',10,400,4000,NULL),($6,$2,$3,$4,$7,'SALE',-2,400,800,$8)`,[randomUUID(),tenant,outlet,product,receiptCommand,randomUUID(),saleCommand,order]);
      for(const entry of [{type:'INVENTORY_RECEIPT',source:receiptCommand,debit:'INVENTORY',credit:'GOODS_RECEIVED_NOT_INVOICED',amount:4000},{type:'SALE',source:order,debit:'CASH_TILL',credit:'SALES_REVENUE',amount:1000},{type:'SALE_COGS',source:order,debit:'COST_OF_GOODS_SOLD',credit:'INVENTORY',amount:800}]){
        const journal=randomUUID();
        await client.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,$3,$4,'KES',$5)",[journal,tenant,entry.type,entry.source,operator]);
        await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,0),($6,$2,$3,$7,0,$5)',[randomUUID(),tenant,journal,entry.debit,entry.amount,randomUUID(),entry.credit]);
      }
      for(const [id,type,status] of [[receiptCommand,'inventory.receive','CONFIRMED'],[saleCommand,'sales.order.settle','CONFIRMED'],[attemptCommand,'inventory.count.save','EXECUTING']] as const){
        await client.query('INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[tenant,id,operator,device,type,Buffer.from('original-fingerprint-'+id),status,status==='CONFIRMED'?JSON.stringify({status,value:{originalId:id}}):null]);
      }
      for(const [status,id] of Object.entries(counts)){
        await client.query(`INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,status,area_label,version,opened_by,posted_by,posted_at,cancelled_by,cancelled_at)
          VALUES($1,$2,$3,$4,$5,3,$6,CASE WHEN $4='POSTED' THEN $6::uuid END,CASE WHEN $4='POSTED' THEN now() END,CASE WHEN $4='CANCELLED' THEN $6::uuid END,CASE WHEN $4='CANCELLED' THEN now() END)`,[id,tenant,outlet,status,'Original '+status+' label',operator]);
        await client.query(`INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor,baseline_inventory_value_minor,counted_quantity,variance_reason,counted_by,counted_at)
          VALUES($1,$2,$3,$4,'COUNT-UPGRADE','Original counted label','each',8,1,400,$8,$5::numeric,$6,$7,now())`,[tenant,outlet,id,product,status==='OPEN'?'7.5':status==='POSTED'?'8':'4',status==='OPEN'?'Original damaged-item note':status==='CANCELLED'?'Original cancelled note':null,operator,status==='CANCELLED'?'9007199254740993':'3200']);
      }
      await client.query('COMMIT');
      const originalSnapshot=async()=>{
        const snapshot:Record<string,unknown>={};
        for(const table of ['catalog.products','inventory.balances','inventory.movements','commerce.shifts','commerce.orders','commerce.order_lines','commerce.payments','finance.journal_entries','finance.journal_lines','system.commands','inventory.stock_counts','inventory.stock_count_lines']){
          let expression='to_jsonb(x)';
          if(table==='inventory.movements')expression+="-'movement_seq'";
          if(table==='inventory.stock_counts')for(const column of ['recovery_protocol','baseline_revision','recovery_coverage','last_event_id','last_reviewed_at','last_reviewed_by','review_nonce'])expression+="-'"+column+"'";
          if(table==='inventory.stock_count_lines')for(const column of ['baseline_revision','reviewed_product_version','baseline_item_kind','baseline_active','movement_after','counted_revision','requires_recount'])expression+="-'"+column+"'";
          snapshot[table]=(await client!.query(`SELECT (${expression})::text AS evidence FROM ${table} x ORDER BY (${expression})::text`)).rows;
        }
        return snapshot;
      };
      const before=await originalSnapshot();
      await t.test('upgrade and checksum rerun retain every original field and expose honest legacy coverage',async()=>{
        migrate();const rerun=migrate();
        assert.deepEqual(await originalSnapshot(),before);
        assert.equal((rerun.match(/already applied; checksum matches/g)??[]).length,26);
        assert.equal((await client!.query('SELECT count(*)::int n FROM system.schema_migrations')).rows[0].n,26);
        const headers=(await client!.query('SELECT recovery_protocol,recovery_coverage,last_event_id,review_nonce FROM inventory.stock_counts')).rows;
        assert.equal(headers.length,3);for(const header of headers){assert.equal(header.recovery_protocol,0);assert.equal(header.recovery_coverage,'LEGACY_CHECKPOINT');assert.ok(header.last_event_id);}
        assert.equal(new Set(headers.map(header=>header.review_nonce)).size,3);assert.ok(headers.every(header=>/^[0-9a-f-]{36}$/.test(header.review_nonce)));
        const lines=(await client!.query('SELECT reviewed_product_version,movement_after,counted_revision FROM inventory.stock_count_lines')).rows;
        for(const line of lines){assert.equal(line.reviewed_product_version,null);assert.equal(line.movement_after,null);assert.equal(line.counted_revision,1);}
        const events=(await client!.query('SELECT event_type,actor_id,command_id,count_version FROM inventory.stock_count_events')).rows;
        assert.equal(events.length,3);for(const event of events){assert.equal(event.event_type,'LEGACY_CHECKPOINT');assert.equal(event.actor_id,null);assert.equal(event.command_id,null);assert.equal(String(event.count_version),'3');}
        const snapshots=(await client!.query('SELECT e.after_state::text AS historical_line,to_jsonb(l)::text AS current_line FROM inventory.stock_count_line_events e JOIN inventory.stock_count_lines l USING(tenant_id,outlet_id,count_id,product_id)')).rows;
        assert.equal(snapshots.length,3);for(const row of snapshots)assert.equal(row.historical_line,row.current_line);
        const highValue=(await client!.query("SELECT after_state->>'baseline_inventory_value_minor' AS value FROM inventory.stock_count_line_events WHERE count_id=$1",[counts.CANCELLED])).rows[0];
        assert.equal(highValue.value,'9007199254740993','A cancelled legacy carrying-value snapshot must remain exact beyond JavaScript safe integers.');
        const ordinals=(await client!.query('SELECT movement_seq::text seq FROM inventory.movements')).rows.map(row=>row.seq);
        assert.equal(new Set(ordinals).size,2);assert.ok(ordinals.every(seq=>BigInt(seq)>0n));
      });
      const allCountEvidence=async()=>{
        const result:Record<string,unknown>={};
        for(const table of ['inventory.stock_counts','inventory.stock_count_lines','inventory.stock_count_events','inventory.stock_count_line_events','inventory.movements'])result[table]=(await client!.query(`SELECT to_jsonb(x)::text AS evidence FROM ${table} x ORDER BY to_jsonb(x)::text`)).rows;
        return result;
      };
      await t.test('legacy writers cannot save post or erase count projections and original opening facts',async()=>{
        const original=await allCountEvidence();
        await assert.rejects(client!.query('UPDATE inventory.stock_counts SET version=version+1 WHERE id=$1',[counts.OPEN]),{code:'23514'});
        await assert.rejects(client!.query("UPDATE inventory.stock_counts SET status='POSTED',version=version+1,posted_by=$2,posted_at=now() WHERE id=$1",[counts.OPEN,operator]),{code:'23514'});
        await assert.rejects(client!.query('UPDATE inventory.stock_count_lines SET counted_quantity=8 WHERE count_id=$1',[counts.OPEN]),{code:'23514'});
        await assert.rejects(client!.query('DELETE FROM inventory.stock_count_lines WHERE count_id=$1',[counts.OPEN]),{code:'55000'});
        for(const change of ["area_label='Rewritten opening label'","baseline_at=baseline_at+interval '1 day'","opened_at=opened_at+interval '1 day'","review_nonce=gen_random_uuid()"]){
          await assert.rejects(client!.query(`UPDATE inventory.stock_counts SET ${change} WHERE id=$1`,[counts.OPEN]),{code:'55000'});
        }
        await assert.rejects(client!.query("UPDATE inventory.stock_counts SET area_label='Rewritten posted label' WHERE id=$1",[counts.POSTED]),{code:'55000'});
        await assert.rejects(client!.query('UPDATE inventory.stock_count_lines SET counted_quantity=7 WHERE count_id=$1',[counts.POSTED]),{code:'55000'});
        assert.deepEqual(await allCountEvidence(),original);assert.deepEqual(await originalSnapshot(),before);
      });
      await t.test('checkpoint line history movements and sealed count history reject rewriting or append-after-close',async()=>{
        const original=await allCountEvidence();
        for(const table of ['inventory.stock_count_events','inventory.stock_count_line_events','inventory.movements']){
          const update=table==='inventory.stock_count_events'?"reason='Rewritten'":table==='inventory.stock_count_line_events'?"after_state='{}'::jsonb":"document_reference='Rewritten'";
          await assert.rejects(client!.query(`UPDATE ${table} SET ${update}`),{code:'55000'});
          await assert.rejects(client!.query(`DELETE FROM ${table}`),{code:'55000'});
        }
        await assert.rejects(client!.query(`INSERT INTO inventory.stock_count_line_events(tenant_id,outlet_id,count_id,event_id,product_id,before_state,after_state)
          SELECT tenant_id,outlet_id,id,last_event_id,$2,NULL,'{}'::jsonb FROM inventory.stock_counts WHERE id=$1`,[counts.POSTED,extraProduct]),error=>['23514','55000'].includes((error as{code:string}).code));
        assert.deepEqual(await allCountEvidence(),original);assert.deepEqual(await originalSnapshot(),before);
      });
      await t.test('count history cannot attribute a foreign actor or attach a foreign product or count scope',async()=>{
        const original=await allCountEvidence();
        const insertEvent=(id:string,actor:string,scopeTenant=tenant,scopeOutlet=outlet)=>client!.query(`INSERT INTO inventory.stock_count_events(id,tenant_id,outlet_id,count_id,count_version,revision,count_status,event_type,command_id,actor_id,actor_name_snapshot)
          VALUES($1,$2,$3,$4,4,1,'OPEN','SAVED',$5,$6,'Scope probe')`,[id,scopeTenant,scopeOutlet,counts.OPEN,attemptCommand,actor]);
        const scopeRejection=(error:unknown)=>['23503','23514','55000'].includes((error as{code:string}).code);
        await assert.rejects(insertEvent(randomUUID(),foreignUser),scopeRejection);
        await assert.rejects(insertEvent(randomUUID(),foreignUser,foreignTenant,foreignOutlet),scopeRejection);
        await client!.query('BEGIN');
        try{
          const eventId=randomUUID();await insertEvent(eventId,operator);
          await assert.rejects(client!.query(`INSERT INTO inventory.stock_count_line_events(tenant_id,outlet_id,count_id,event_id,product_id,before_state,after_state)
            VALUES($1,$2,$3,$4,$5,NULL,'{}'::jsonb)`,[tenant,outlet,counts.OPEN,eventId,foreignProduct]),{code:'23503'});
        }finally{await client!.query('ROLLBACK');}
        assert.deepEqual(await allCountEvidence(),original);assert.deepEqual(await originalSnapshot(),before);
      });
    }finally{
      await client?.end();try{if(created)await admin.query(`DROP DATABASE "${name}"`);}finally{await admin.end();}
    }
  });
}
