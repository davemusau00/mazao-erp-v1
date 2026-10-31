import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { test } from 'node:test';

const sourceUrl=process.env.TEST_DATABASE_URL;
if(!sourceUrl) {
  test('restaurant order expansion preserves accepted configuration',{skip:'Requires disposable localhost PostgreSQL with CREATE DATABASE permission.'},()=>{});
} else {
  test('029 to 031 preserves populated configuration and business evidence and remains checksum safe',{timeout:120_000},async t=>{
    const source=new URL(sourceUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(source.hostname));
    const databaseName=`mazao_orders_upgrade_${randomUUID().replaceAll('-','')}`;
    const maintenance=new URL(source);maintenance.pathname='/postgres';
    const disposable=new URL(source);disposable.pathname='/'+databaseName;
    const admin=new Client({connectionString:maintenance.href});
    let client:Client|undefined,created=false;
    const migrate=(target:string)=>{
      const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/migration.ts',import.meta.url))],{cwd:process.cwd(),encoding:'utf8',timeout:60_000,env:{...process.env,DATABASE_URL:disposable.href,MIGRATION_TARGET:target}});
      assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;
    };
    try {
      await admin.connect();await admin.query(`CREATE DATABASE "${databaseName}"`);created=true;
      migrate('029_restaurant_configuration');client=new Client({connectionString:disposable.href});await client.connect();
      const tenant=randomUUID(),outlet=randomUUID(),otherOutlet=randomUUID(),user=randomUUID(),device=randomUUID(),product=randomUUID(),section=randomUUID(),table=randomUUID(),station=randomUUID(),command=randomUUID(),receiveCommand=randomUUID();
      await client.query('BEGIN');
      await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Orders upgrade business','KES','Africa/Nairobi')",[tenant]);
      await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$3,'Existing service outlet','Africa/Nairobi'),($2,$3,'Other outlet','Africa/Nairobi')",[outlet,otherOutlet,tenant]);
      await client.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'restaurant')",[tenant]);
      await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'unusable-upgrade-fixture-hash','Existing restaurant owner')",[user,`${user}@example.invalid`]);
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenant,user]);
      await client.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label,version) VALUES($1,$2,$3,$4,'Existing logical station workspace',7)",[device,tenant,outlet,user]);
      await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,item_kind) VALUES($1,$2,$3,'SOURCE-UPGRADE','Existing menu item','each','KES',500,200,1600,'STOCKED_GOOD')",[product,tenant,outlet]);
      await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,3,600)',[tenant,outlet,product]);
      await client.query("INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor) VALUES($1,$2,$3,$4,$5,'RECEIPT',3,200,600)",[randomUUID(),tenant,outlet,product,receiveCommand]);
      const journal=randomUUID();
      await client.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,'INVENTORY_RECEIPT',$3,'KES',$4)",[journal,tenant,receiveCommand,user]);
      await client.query("INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,'INVENTORY',600,0),($4,$2,$3,'GOODS_RECEIVED_NOT_INVOICED',0,600)",[randomUUID(),tenant,journal,randomUUID()]);
      await client.query("INSERT INTO restaurant.sections(id,tenant_id,outlet_id,name) VALUES($1,$2,$3,'Existing dining area')",[section,tenant,outlet]);
      await client.query("INSERT INTO restaurant.tables(id,tenant_id,outlet_id,section_id,name,seats) VALUES($1,$2,$3,$4,'Existing Table 1',4)",[table,tenant,outlet,section]);
      await client.query("INSERT INTO restaurant.stations(id,tenant_id,outlet_id,name,kind,characters_per_line) VALUES($1,$2,$3,'Existing kitchen','KITCHEN',42)",[station,tenant,outlet]);
      await client.query("INSERT INTO restaurant.menu_routes(tenant_id,outlet_id,product_id,preparation_label,instructions) VALUES($1,$2,$3,'Existing preparation name','Existing instructions')",[tenant,outlet,product]);
      await client.query('INSERT INTO restaurant.menu_route_stations(tenant_id,outlet_id,product_id,station_id) VALUES($1,$2,$3,$4)',[tenant,outlet,product,station]);
      await client.query('INSERT INTO restaurant.station_assignments(tenant_id,outlet_id,device_id,device_version,version) VALUES($1,$2,$3,7,3)',[tenant,outlet,device]);
      await client.query('INSERT INTO restaurant.station_assignment_links(tenant_id,outlet_id,device_id,station_id) VALUES($1,$2,$3,$4)',[tenant,outlet,device,station]);
      const response={status:'CONFIRMED',value:{productId:product,version:1}};
      await client.query("INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,'restaurant.menu.save',$5,'CONFIRMED',$6::jsonb,now(),1,ARRAY['commerce','restaurant'])",[tenant,command,user,device,Buffer.from('original-configuration-fingerprint'),JSON.stringify(response)]);
      await client.query("INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,'restaurant.menu.save',$6::jsonb)",[randomUUID(),tenant,outlet,user,command,JSON.stringify({before:null,after:response.value,deviceId:device,configurationOnly:true})]);
      await client.query("INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,'restaurant.menu.save',$4::jsonb)",[randomUUID(),tenant,command,JSON.stringify(response.value)]);
      await client.query('COMMIT');
      const tables=(await client.query<{schema:string;name:string}>("SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN ('core','identity','catalog','inventory','commerce','hospitality','finance','system','restaurant') AND NOT (schemaname='system' AND tablename='schema_migrations') ORDER BY schemaname,tablename")).rows;
      const snapshot=async()=>{
        const result:Record<string,unknown>={};
        for(const table of tables) {
          const identifier=[table.schema,table.name].map(part=>'"'+part.replaceAll('"','""')+'"').join('.');
          result[identifier]=(await client!.query(`SELECT to_jsonb(x)::text evidence FROM ${identifier} x ORDER BY to_jsonb(x)::text`)).rows;
        }
        return result;
      };
      const before=await snapshot();
      await t.test('additive expansion and rerun preserve every original row and checksum',async()=>{
        const applied=migrate('030_restaurant_orders_fire');assert.match(applied,/Applied 030_restaurant_orders_fire/);
        assert.deepEqual(await snapshot(),before);
        const rerun=migrate('030_restaurant_orders_fire');assert.equal((rerun.match(/already applied; checksum matches/g)??[]).length,30);
        assert.deepEqual(await snapshot(),before);
        const checksum=createHash('sha256').update(readFileSync(new URL('../migrations/030_restaurant_orders_fire.sql',import.meta.url))).digest('hex');
        assert.equal((await client!.query("SELECT checksum FROM system.schema_migrations WHERE version='030_restaurant_orders_fire'")).rows[0].checksum,checksum);
        assert.deepEqual((await client!.query('SELECT device_version::text,version::text FROM restaurant.station_assignments WHERE tenant_id=$1',[tenant])).rows,[{device_version:'7',version:'3'}]);
        const counts=await client!.query('SELECT (SELECT count(*)::int FROM restaurant.orders) orders,(SELECT count(*)::int FROM restaurant.order_lines) lines,(SELECT count(*)::int FROM restaurant.fire_batches) batches,(SELECT count(*)::int FROM restaurant.tickets) tickets');
        assert.deepEqual(counts.rows[0],{orders:0,lines:0,batches:0,tickets:0},'Migration must not invent source orders or tickets.');
      });
      await t.test('031 backfills existing immutable tickets into NEW with the original fire authority',async()=>{
        const orderId=randomUUID(),batchId=randomUUID(),ticketId=randomUUID(),fireCommand=randomUUID();
        await client!.query("INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,'restaurant.order.fire',$5,'CONFIRMED',$6::jsonb,now(),1,ARRAY['commerce','restaurant'])",[tenant,fireCommand,user,device,Buffer.from('fire-upgrade-fingerprint'),JSON.stringify({status:'CONFIRMED'})]);
        await client!.query("INSERT INTO restaurant.orders(id,tenant_id,outlet_id,table_id,table_name_snapshot,service_label,owner_id,owner_name_snapshot,created_by_device_id,currency,status,fire_revision) VALUES($1,$2,$3,$4,'Existing Table 1','Existing fired order',$5,'Existing restaurant owner',$6,'KES','FIRED',1)",[orderId,tenant,outlet,table,user,device]);
        await client!.query("INSERT INTO restaurant.fire_batches(id,tenant_id,outlet_id,order_id,fire_revision,ticket_type,command_id,actor_id,device_id) VALUES($1,$2,$3,$4,1,'NEW',$5,$6,$7)",[batchId,tenant,outlet,orderId,fireCommand,user,device]);
        await client!.query("INSERT INTO restaurant.tickets(id,tenant_id,outlet_id,order_id,batch_id,station_id,station_name_snapshot,station_kind_snapshot,document_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,'Existing kitchen','KITCHEN',$7,$8::jsonb)",[ticketId,tenant,outlet,orderId,batchId,station,'a'.repeat(64),JSON.stringify({ticketId,orderId})]);
        const applied=migrate('031_restaurant_ticket_lifecycle');assert.match(applied,/Applied 031_restaurant_ticket_lifecycle/);
        assert.deepEqual((await client!.query('SELECT event_version,status,previous_status,command_id,actor_id,actor_name_snapshot,device_id FROM restaurant.ticket_state_events WHERE ticket_id=$1',[ticketId])).rows,[{event_version:1,status:'NEW',previous_status:null,command_id:fireCommand,actor_id:user,actor_name_snapshot:'Existing restaurant owner',device_id:device}]);
        const rerun=migrate('031_restaurant_ticket_lifecycle');assert.equal((rerun.match(/already applied; checksum matches/g)??[]).length,31);
        const checksum=createHash('sha256').update(readFileSync(new URL('../migrations/031_restaurant_ticket_lifecycle.sql',import.meta.url))).digest('hex');
        assert.equal((await client!.query("SELECT checksum FROM system.schema_migrations WHERE version='031_restaurant_ticket_lifecycle'")).rows[0].checksum,checksum);
        await assert.rejects(client!.query("UPDATE restaurant.ticket_state_events SET status='READY' WHERE ticket_id=$1",[ticketId]),{code:'23514'});
      });
      await t.test('new source table references cannot cross the upgraded outlet boundary',async()=>{
        const otherDevice=randomUUID();
        await client!.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Other outlet assignment')",[otherDevice,tenant,otherOutlet,user]);
        await assert.rejects(client!.query("INSERT INTO restaurant.orders(id,tenant_id,outlet_id,table_id,table_name_snapshot,service_label,owner_id,owner_name_snapshot,created_by_device_id,currency) VALUES($1,$2,$3,$4,'Existing Table 1','Foreign table reference',$5,'Existing owner',$6,'KES')",[randomUUID(),tenant,otherOutlet,table,user,otherDevice]),{code:'23503'});
        await assert.rejects(client!.query("INSERT INTO restaurant.orders(id,tenant_id,outlet_id,table_id,service_label,owner_id,owner_name_snapshot,created_by_device_id,currency) VALUES($1,$2,$3,NULL,'Foreign logical workspace',$4,'Existing owner',$5,'KES')",[randomUUID(),tenant,otherOutlet,user,device]),{code:'23503'});
        await client!.query('DELETE FROM identity.devices WHERE id=$1',[otherDevice]);
        assert.deepEqual(await snapshot(),before,'Failed scope attacks must not rewrite original setup, inventory or accounting evidence.');
      });
    } finally {
      await client?.end();
      try {if(created)await admin.query(`DROP DATABASE "${databaseName}"`);}finally{await admin.end();}
    }
  });
}
