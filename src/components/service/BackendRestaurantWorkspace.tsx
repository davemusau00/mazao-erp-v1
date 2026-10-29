import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChefHat, Plus, RefreshCw } from 'lucide-react';
import { apiClient, ApiClientError, type BackendCommand, type BackendCommandResult } from '../../services/apiClient';
import type { RestaurantConfiguration, RestaurantMenuRoute, RestaurantProduct, RestaurantSection, RestaurantStation, RestaurantStationAssignment, RestaurantTable } from '../../types/restaurant';
import type { HistoryPage } from '../../types/history';
import { catalogItemKindLabel } from '../../types/catalog';
import { useCommandRecoveryReadiness } from '../../hooks/useCommandRecoveryReadiness';
import { CommandRecoveryReadiness } from '../common/CommandRecoveryReadiness';
import { ResponsiveDialog } from '../common/ResponsiveDialog';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';

type View='areas'|'tables'|'stations'|'menu'|'access';
type Editor={kind:'area';record?:RestaurantSection}|{kind:'table';record?:RestaurantTable}|{kind:'station';record?:RestaurantStation}|{kind:'menu';record?:RestaurantMenuRoute}|{kind:'access';record?:RestaurantStationAssignment};
const inputClass='mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100';
const actionClass='min-h-11 rounded-lg border border-zinc-700 px-3 text-sm font-semibold disabled:opacity-50';

export function BackendRestaurantWorkspace(){
  const session=apiClient.getSession()!;
  const [configuration,setConfiguration]=useState<RestaurantConfiguration|null>(null);
  const [view,setView]=useState<View>('areas');
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[online,setOnline]=useState(navigator.onLine),[unknownId,setUnknownId]=useState('');
  const [editor,setEditor]=useState<Editor|null>(null),[dirty,setDirty]=useState(false);
  const [name,setName]=useState(''),[active,setActive]=useState(true),[sectionId,setSectionId]=useState(''),[seats,setSeats]=useState('2');
  const [stationKind,setStationKind]=useState<RestaurantStation['kind']>('KITCHEN'),[characters,setCharacters]=useState('42');
  const [productId,setProductId]=useState(''),[preparationLabel,setPreparationLabel]=useState(''),[instructions,setInstructions]=useState(''),[stationIds,setStationIds]=useState<string[]>([]),[deviceId,setDeviceId]=useState('');
  const [products,setProducts]=useState<RestaurantProduct[]>([]),[productPage,setProductPage]=useState<HistoryPage|null>(null),[productQuery,setProductQuery]=useState(''),[productBusy,setProductBusy]=useState(false),[productError,setProductError]=useState('');
  const selectedProduct=useRef<RestaurantProduct|null>(null),appliedProductQuery=useRef('');
  // Background reads can refresh directory cards, but only opening an editor
  // or explicitly choosing an identity establishes the versions being reviewed.
  const reviewedMenu=useRef<{productId:string;productVersion:number;routeVersion:number|null}|null>(null);
  const reviewedAccess=useRef<{deviceId:string;deviceVersion:number;assignmentVersion:number|null}|null>(null);
  const pending=useRef<BackendCommand|null>(null),mounted=useRef(true),loadGeneration=useRef(0),productGeneration=useRef(0),controller=useRef<AbortController|null>(null),loadValid=useRef(false);
  const recovery=useCommandRecoveryReadiness('restaurant.',command=>{pending.current=command;setUnknownId(command.commandId);setNotice('A restaurant setup change needs review. Check its status before making another change.');});
  const canManage=Boolean(configuration?.permissions.manage)&&session.user.permissions.includes('restaurant.manage');
  const canAssign=canManage&&Boolean(configuration?.permissions.assignDevices)&&session.user.permissions.includes('devices.manage');
  const locked=loading||!!loadError||!configuration||!recovery.ready||busy||!!unknownId||!online;
  const refresh=useCallback(async()=>{
    controller.current?.abort();const readController=new AbortController();controller.current=readController;const generation=++loadGeneration.current;
    loadValid.current=false;setLoading(true);setLoadError('');
    try{
      const result=await apiClient.getRestaurantConfiguration(readController.signal);
      if(!mounted.current||generation!==loadGeneration.current)return;
      setConfiguration(result.configuration);loadValid.current=true;
      if(!editor){setProducts(result.configuration.products);setProductPage(result.configuration.productPage);appliedProductQuery.current='';setProductQuery('');}
    }catch(cause){if(mounted.current&&generation===loadGeneration.current&&!(cause instanceof ApiClientError&&cause.code==='REQUEST_CANCELLED'))setLoadError(cause instanceof Error?cause.message:'Restaurant setup could not load. Try again.');}
    finally{if(mounted.current&&generation===loadGeneration.current)setLoading(false);}
  },[session.tenant.id,session.outlet.id,editor]);
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  useEffect(()=>{mounted.current=true;void refreshRef.current();return()=>{mounted.current=false;++loadGeneration.current;++productGeneration.current;controller.current?.abort();};},[session.tenant.id,session.outlet.id]);
  useEffect(()=>{
    const disconnected=()=>{loadValid.current=false;setOnline(false);++loadGeneration.current;controller.current?.abort();setLoading(false);};
    const reconnected=()=>{setOnline(true);void refreshRef.current();};
    window.addEventListener('offline',disconnected);window.addEventListener('online',reconnected);
    return()=>{window.removeEventListener('offline',disconnected);window.removeEventListener('online',reconnected);};
  },[]);
  useEffect(()=>{
    const beforeNavigate=(event:Event)=>{if(dirty&&!window.confirm('Discard unsaved restaurant setup changes and leave this page?'))event.preventDefault();};
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('mazao:before-navigate',beforeNavigate);window.addEventListener('beforeunload',beforeUnload);
    return()=>{window.removeEventListener('mazao:before-navigate',beforeNavigate);window.removeEventListener('beforeunload',beforeUnload);};
  },[dirty]);
  const clearEditor=()=>{++productGeneration.current;setEditor(null);setDirty(false);setProductError('');setProductBusy(false);reviewedMenu.current=null;reviewedAccess.current=null;};
  const openEditor=(next:Editor)=>{
    if(locked||!canManage||next.kind==='access'&&!canAssign)return;
    setError('');setEditor(next);setDirty(false);setActive(true);setName('');setStationIds([]);setProductQuery('');setProductError('');setProductBusy(false);appliedProductQuery.current='';
    setProducts(configuration!.products);setProductPage(configuration!.productPage);selectedProduct.current=null;reviewedMenu.current=null;reviewedAccess.current=null;
    if(next.kind==='area'){setName(next.record?.name??'');setActive(next.record?.active??true);}
    if(next.kind==='table'){setName(next.record?.name??'');setActive(next.record?.active??true);setSectionId(next.record?.sectionId??'');setSeats(String(next.record?.seats??2));}
    if(next.kind==='station'){setName(next.record?.name??'');setActive(next.record?.active??true);setStationKind(next.record?.kind??'KITCHEN');setCharacters(String(next.record?.charactersPerLine??42));}
    if(next.kind==='menu'){
      const route=next.record;setProductId(route?.productId??'');setPreparationLabel(route?.preparationLabel??'');setInstructions(route?.instructions??'');setStationIds(route?.stationIds??[]);setActive(route?.available??true);
      if(route){const known=configuration!.products.find(product=>product.id===route.productId);selectedProduct.current=known??{id:route.productId,name:route.productName,sku:route.sku,itemKind:route.itemKind,version:route.productVersion,active:route.productActive,currency:route.currency,sellingPriceMinor:route.sellingPriceMinor,taxRateBps:route.taxRateBps};reviewedMenu.current={productId:route.productId,productVersion:route.productVersion,routeVersion:route.version};}
    }
    if(next.kind==='access'){setDeviceId(next.record?.deviceId??'');setStationIds(next.record?.stationIds??[]);const device=configuration!.devices.find(row=>row.id===next.record?.deviceId);if(next.record&&device)reviewedAccess.current={deviceId:device.id,deviceVersion:device.version,assignmentVersion:next.record.version};}
  };
  const chooseMenuProduct=(id:string)=>{
    const product=products.find(row=>row.id===id);setError('');
    if(configuration!.menuRoutes.some(route=>route.productId===id)){
      setProductId('');selectedProduct.current=null;reviewedMenu.current=null;
      setError('This item already has menu routing. Cancel this form and use Edit on its existing menu route.');return;
    }
    setProductId(id);selectedProduct.current=product??null;
    reviewedMenu.current=product?{productId:product.id,productVersion:product.version,routeVersion:null}:null;
  };
  const chooseAccessDevice=(id:string)=>{
    const device=configuration!.devices.find(row=>row.id===id),assignment=configuration!.stationAssignments.find(row=>row.deviceId===id);
    setDeviceId(id);setStationIds(assignment?.stationIds??[]);
    reviewedAccess.current=device?{deviceId:device.id,deviceVersion:device.version,assignmentVersion:assignment?.version??null}:null;
  };
  const acknowledge=async(command:BackendCommand,result:BackendCommandResult)=>{
    if(!mounted.current)return;
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){
      pending.current=null;setUnknownId('');
      if(result.status==='CONFIRMED'){clearEditor();setError('');setNotice('Restaurant setup saved.');await refreshRef.current();}
      else{setError(result.message??'This setup change was not saved. Review the details and try again.');if(result.status==='CONFLICT'){loadValid.current=false;setLoadError('These details changed elsewhere. Refresh setup, reopen the entry and review it before saving.');}}
      await recovery.inspect();
    }else{pending.current=command;setUnknownId(command.commandId);setNotice('We could not confirm this setup change. Check its status before trying again.');}
  };
  const send=async(command:BackendCommand)=>{
    if(locked||!loadValid.current||pending.current||!navigator.onLine||!canManage||!recovery.begin())return;
    pending.current=command;setBusy(true);setError('');setNotice('');
    try{await acknowledge(command,await apiClient.submitCommand(command));}
    catch(cause){if(mounted.current){if(cause instanceof ApiClientError&&cause.code==='COMMAND_NOT_SENT'){pending.current=null;setError(cause.message);}else{setUnknownId(command.commandId);setNotice(cause instanceof Error?cause.message:'We could not confirm this setup change. Check its status.');}}}
    finally{recovery.finish();if(mounted.current)setBusy(false);}
  };
  const recover=async()=>{
    const command=pending.current;if(!command||busy||!online||!recovery.begin())return;
    setBusy(true);setError('');
    try{
      try{const result=await apiClient.checkCommandStatus(command.commandId);await acknowledge(command,result.response as unknown as BackendCommandResult);}
      catch(cause){if(cause instanceof ApiClientError&&cause.status===404)await acknowledge(command,await apiClient.submitCommand(command));else throw cause;}
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'The change is still unconfirmed. Keep its original details and try checking again.');}
    finally{recovery.finish();if(mounted.current)setBusy(false);}
  };
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();if(!editor||locked||!canManage)return;
    let type='',payload:Record<string,unknown>={},expectedVersions:Record<string,number>={};
    if(editor.kind==='area'){type='restaurant.section.save';payload={...(editor.record?{sectionId:editor.record.id}:{}),name:name.trim(),active};if(editor.record)expectedVersions['section:'+editor.record.id]=editor.record.version;}
    if(editor.kind==='table'){type='restaurant.table.save';payload={...(editor.record?{tableId:editor.record.id}:{}),name:name.trim(),sectionId:sectionId||null,seats:Number(seats),active};if(editor.record)expectedVersions['table:'+editor.record.id]=editor.record.version;}
    if(editor.kind==='station'){type='restaurant.station.save';payload={...(editor.record?{stationId:editor.record.id}:{}),name:name.trim(),kind:stationKind,charactersPerLine:Number(characters),active};if(editor.record)expectedVersions['station:'+editor.record.id]=editor.record.version;}
    if(editor.kind==='menu'){
      const reviewed=reviewedMenu.current;
      if(!reviewed||reviewed.productId!==productId){setError('Choose a current menu item before saving.');return;}
      type='restaurant.menu.save';payload={productId,stationIds,preparationLabel:preparationLabel.trim(),instructions:instructions.trim(),available:active};expectedVersions['product:'+productId]=reviewed.productVersion;
      if(reviewed.routeVersion!==null)expectedVersions['menu:'+productId]=reviewed.routeVersion;
    }
    if(editor.kind==='access'){
      if(!canAssign)return;const reviewed=reviewedAccess.current;if(!reviewed||reviewed.deviceId!==deviceId)return;
      type='restaurant.station.assign';payload={deviceId,stationIds};expectedVersions['device:'+deviceId]=reviewed.deviceVersion;
      if(reviewed.assignmentVersion!==null)expectedVersions['stationAssignment:'+deviceId]=reviewed.assignmentVersion;
    }
    await send({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
  };
  const loadProducts=async(append=false)=>{
    const generation=++productGeneration.current;setProductBusy(true);setProductError('');
    const query=append?appliedProductQuery.current:productQuery.trim();
    try{
      const result=await apiClient.listRestaurantProducts({q:query,...(append&&productPage?.nextCursor?{after:productPage.nextCursor}:{})});
      if(!mounted.current||generation!==productGeneration.current)return;
      setProducts(previous=>append?[...previous,...result.products.filter(row=>!previous.some(item=>item.id===row.id))]:result.products);setProductPage(result.page);appliedProductQuery.current=query;
    }catch(cause){if(mounted.current&&generation===productGeneration.current)setProductError(cause instanceof Error?cause.message:'Menu items could not load. Retry the search.');}
    finally{if(mounted.current&&generation===productGeneration.current)setProductBusy(false);}
  };
  const stationNames=(ids:string[])=>ids.map(id=>{const station=configuration?.stations.find(row=>row.id===id);return station?station.name+(station.active?'':' (inactive)'):'Unavailable station';}).join(', ');
  const changeStations=(id:string,checked:boolean)=>{setStationIds(previous=>checked?[...previous,id]:previous.filter(value=>value!==id));setDirty(true);};
  const editorTitle=editor?.kind==='area'?(editor.record?'Edit service area':'Add service area'):editor?.kind==='table'?(editor.record?'Edit table':'Add table'):editor?.kind==='station'?(editor.record?'Edit preparation station':'Add preparation station'):editor?.kind==='menu'?(editor.record?'Edit menu routing':'Add menu routing'):'Assign stations';
  const saveLabel=editor?.kind==='area'?'Save area':editor?.kind==='table'?'Save table':editor?.kind==='station'?'Save station':editor?.kind==='menu'?'Save menu routing':'Save station access';
  const titles:Record<View,string>={areas:'Service areas',tables:'Tables',stations:'Preparation stations',menu:'Menu routing',access:'Station access'};
  const listClass='rounded-xl border border-zinc-800 bg-zinc-950 p-4';
  return <div className="page-stack">
    <WorkspaceHeading eyebrow={session.outlet.name} title="Restaurant setup" description="Prepare service areas, tables, kitchen and bar stations, and menu routing." action={<button type="button" className={`${actionClass} flex items-center gap-2`} disabled={busy||loading||!!unknownId||!online||!!editor} onClick={()=>void refresh()}><RefreshCw size={16}/>Refresh setup</button>}/>
    <p className="rounded-xl border border-amber-800 bg-amber-950/20 p-3 text-sm leading-6 text-amber-100">Setup only. Taking table orders, sending kitchen or bar tickets, printing, live kitchen preparation and room charges are unavailable. Prepared items cannot be sold until recipe consumption is supported.</p>
    <CommandRecoveryReadiness ready={recovery.ready} error={recovery.error} retry={()=>void recovery.inspect()}/>
    {!online&&<p role="alert" className="rounded-lg border border-amber-700 p-3 text-sm text-amber-100">Restaurant setup is out of date while offline. Reconnect and refresh before making changes.</p>}
    {loadError&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{loadError}</p>}
    {error&&<p role="alert" className="rounded-lg border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}
    {notice&&<div role={unknownId?'alert':'status'} className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-800 p-3 text-sm text-blue-100"><p>{notice}</p>{unknownId&&<button type="button" className={actionClass} disabled={busy||!online} onClick={()=>void recover()}>{busy?'Checking…':'Check setup change status'}</button>}</div>}
    {loading&&<p role="status" className="text-sm text-zinc-400">Loading restaurant setup…</p>}
    {configuration&&<>
      <nav aria-label="Restaurant setup sections" className="flex flex-wrap gap-2">{(Object.keys(titles) as View[]).filter(tab=>tab!=='access'||canAssign).map(tab=><button key={tab} type="button" aria-pressed={view===tab} className={`${actionClass} ${view===tab?'border-blue-500 bg-blue-950 text-blue-100':''}`} onClick={()=>setView(tab)}>{titles[tab]}</button>)}</nav>
      {!canManage&&<p className="text-sm text-zinc-400">You can review restaurant setup. Ask a manager to change it.</p>}
      <section aria-labelledby="restaurant-directory-heading" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="restaurant-directory-heading" className="text-lg font-semibold">{titles[view]}</h2>{canManage&&(view!=='access'||canAssign)&&<button type="button" className={`${actionClass} flex items-center gap-2 border-blue-700 text-blue-200`} disabled={locked} onClick={()=>openEditor(view==='areas'?{kind:'area'}:view==='tables'?{kind:'table'}:view==='stations'?{kind:'station'}:view==='menu'?{kind:'menu'}:{kind:'access'})}><Plus size={16}/>{view==='areas'?'Add service area':view==='tables'?'Add table':view==='stations'?'Add preparation station':view==='menu'?'Add menu routing':'Assign stations'}</button>}</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view==='areas'&&configuration.sections.map(area=><article key={area.id} className={listClass}><h3 className="font-semibold">{area.name}</h3><p className="mt-2 text-sm text-zinc-400">{area.active?'Active':'Inactive'}</p>{canManage&&<button type="button" className={`${actionClass} mt-3`} disabled={locked} aria-label={'Edit area '+area.name} onClick={()=>openEditor({kind:'area',record:area})}>Edit</button>}</article>)}
        {view==='tables'&&configuration.tables.map(table=><article key={table.id} className={listClass}><h3 className="font-semibold">{table.name}</h3><p className="mt-2 text-sm text-zinc-400">{table.sectionId?configuration.sections.find(area=>area.id===table.sectionId)?.name??'Unavailable area':'No service area'} · {table.seats} seats · {table.active?'Active':'Inactive'}</p>{canManage&&<button type="button" className={`${actionClass} mt-3`} disabled={locked} aria-label={'Edit table '+table.name} onClick={()=>openEditor({kind:'table',record:table})}>Edit</button>}</article>)}
        {view==='stations'&&configuration.stations.map(station=><article key={station.id} className={listClass}><h3 className="flex items-center gap-2 font-semibold"><ChefHat size={16}/>{station.name}</h3><p className="mt-2 text-sm text-zinc-400">{station.kind==='BAR'?'Bar':station.kind==='EXPO'?'Expeditor / pass':'Kitchen'} · {station.charactersPerLine} characters per line · {station.active?'Active':'Inactive'}</p>{canManage&&<button type="button" className={`${actionClass} mt-3`} disabled={locked} aria-label={'Edit station '+station.name} onClick={()=>openEditor({kind:'station',record:station})}>Edit</button>}</article>)}
        {view==='menu'&&configuration.menuRoutes.map(route=><article key={route.productId} className={listClass}><h3 className="font-semibold">{route.productName||route.preparationLabel}</h3><p className="mt-1 text-xs text-zinc-500">{route.sku} · {catalogItemKindLabel(route.itemKind)}</p><p className="mt-2 text-sm text-zinc-300">{route.preparationLabel}</p><p className="mt-1 text-sm text-zinc-400">{stationNames(route.stationIds)}</p>{route.instructions&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-400">{route.instructions}</p>}<p className="mt-2 text-sm">{!route.productActive?'Archived item · unavailable':route.effectiveAvailable?'Available in setup':'Unavailable in setup'}</p>{canManage&&<button type="button" className={`${actionClass} mt-3`} disabled={locked} aria-label={'Edit menu routing '+(route.productName||route.preparationLabel)} onClick={()=>openEditor({kind:'menu',record:route})}>Edit</button>}</article>)}
        {view==='access'&&canAssign&&configuration.stationAssignments.map(assignment=><article key={assignment.deviceId} className={listClass}><h3 className="font-semibold">{configuration.devices.find(device=>device.id===assignment.deviceId)?.label??'Inactive workspace assignment'}</h3><p className="mt-2 text-sm text-zinc-400">{assignment.stationIds.length?stationNames(assignment.stationIds):'No stations assigned'}</p>{assignment.stationIds.length>0&&!assignment.effectiveActive&&<p className="mt-2 text-sm text-amber-200">Station access is inactive. Review the workspace assignment and save station access again.</p>}<button type="button" className={`${actionClass} mt-3`} disabled={locked} aria-label={'Edit station access '+(configuration.devices.find(device=>device.id===assignment.deviceId)?.label??'workspace')} onClick={()=>openEditor({kind:'access',record:assignment})}>Edit</button></article>)}
      </div>
      {(view==='areas'?configuration.sections:view==='tables'?configuration.tables:view==='stations'?configuration.stations:view==='menu'?configuration.menuRoutes:configuration.stationAssignments).length===0&&<EmptyState title={'No '+titles[view].toLowerCase()+' yet'} detail={canManage?'Add the setup your team will use in this outlet.':'Ask a manager to set up this outlet.'}/>}
      {view==='access'&&<p className="text-sm text-zinc-400">Station access applies to existing outlet workspace assignments. Physical terminal enrollment, printer connections and kitchen feeds remain unavailable.</p>}
      <p className="text-xs text-zinc-500">Setup capacity: {configuration.limits.sections} service areas, {configuration.limits.tables} tables, {configuration.limits.stations} stations and {configuration.limits.menuRoutes} menu routes per outlet. All saved entries are shown.</p>
      </section>
    </>}
    <ResponsiveDialog isOpen={!!editor} title={editorTitle} subtitle={session.outlet.name} closeDisabled={busy||!!unknownId} onClose={()=>{if(!busy&&!unknownId&&(!dirty||window.confirm('Discard these unsaved restaurant setup changes?')))clearEditor();}} footerActions={<><button type="button" className={actionClass} disabled={busy||!!unknownId} onClick={()=>{if(!dirty||window.confirm('Discard these unsaved restaurant setup changes?'))clearEditor();}}>Cancel</button><button type="submit" form="restaurant-setup-form" className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50" disabled={locked||!dirty||productBusy}>{busy?'Saving…':saveLabel}</button></>}>
      <form id="restaurant-setup-form" onSubmit={event=>void save(event)} onChange={()=>setDirty(true)} className="space-y-4">
        <fieldset disabled={locked} className="space-y-4">
        {(editor?.kind==='area'||editor?.kind==='table'||editor?.kind==='station')&&<label className="block text-sm">{editor.kind==='area'?'Area name':editor.kind==='table'?'Table name':'Station name'}<input className={inputClass} value={name} onChange={event=>setName(event.target.value)} required maxLength={100}/></label>}
        {editor?.kind==='table'&&<><label className="block text-sm"><span id="restaurant-service-area-label">Service area</span><select aria-labelledby="restaurant-service-area-label" className={inputClass} value={sectionId} onChange={event=>setSectionId(event.target.value)}><option value="">No service area</option>{configuration?.sections.filter(area=>area.active||area.id===sectionId).map(area=><option key={area.id} value={area.id}>{area.name}{!area.active?' (inactive)':''}</option>)}</select></label><label className="block text-sm">Seats<input className={inputClass} type="number" min={1} max={100} step={1} value={seats} onChange={event=>setSeats(event.target.value)} required/></label></>}
        {editor?.kind==='station'&&<><label className="block text-sm"><span id="restaurant-station-type-label">Station type</span><select aria-labelledby="restaurant-station-type-label" className={inputClass} value={stationKind} onChange={event=>setStationKind(event.target.value as RestaurantStation['kind'])}><option value="KITCHEN">Kitchen</option><option value="BAR">Bar</option><option value="EXPO">Expeditor / pass</option></select></label><label className="block text-sm">Characters per line<input className={inputClass} type="number" min={32} max={64} step={1} value={characters} onChange={event=>setCharacters(event.target.value)} required/></label><p className="text-xs text-zinc-400">Text width for future 80 mm tickets. This does not connect a printer.</p></>}
        {editor?.kind==='menu'&&<>
          <div className="rounded-lg border border-zinc-800 p-3"><label className="block text-sm">Search menu items<input className={inputClass} value={productQuery} onChange={event=>setProductQuery(event.target.value)} maxLength={120}/></label><button type="button" disabled={locked||productBusy} className={`${actionClass} mt-2`} onClick={()=>void loadProducts()}>Search items</button>{productError&&<p role="alert" className="mt-2 text-sm text-rose-200">{productError}</p>}{productPage&&<p className="mt-2 text-xs text-zinc-400">Showing {products.length} of {productPage.totalCount} matching menu items.</p>}{productPage?.hasMore&&<button type="button" disabled={locked||productBusy} className={`${actionClass} mt-2`} onClick={()=>void loadProducts(true)}>{productBusy?'Loading…':'Load more menu items'}</button>}</div>
          <label className="block text-sm"><span id="restaurant-menu-item-label">Menu item</span><select aria-labelledby="restaurant-menu-item-label" className={inputClass} required value={productId} disabled={!!editor.record||locked||productBusy} onChange={event=>chooseMenuProduct(event.target.value)}><option value="">Choose a menu item</option>{selectedProduct.current&&!products.some(product=>product.id===selectedProduct.current?.id)&&<option value={selectedProduct.current.id}>{selectedProduct.current.name} · {selectedProduct.current.sku}</option>}{products.map(product=><option key={product.id} value={product.id}>{product.name} · {product.sku}{!product.active?' (inactive)':''}</option>)}</select></label>
          <label className="block text-sm">Preparation label<input className={inputClass} value={preparationLabel} onChange={event=>setPreparationLabel(event.target.value)} maxLength={100} required/></label>
          <label className="block text-sm">Preparation instructions<input className={inputClass} value={instructions} onChange={event=>setInstructions(event.target.value)} maxLength={500}/></label>
        </>}
        {editor?.kind==='access'&&<label className="block text-sm"><span id="restaurant-workspace-assignment-label">Workspace assignment</span><select aria-labelledby="restaurant-workspace-assignment-label" className={inputClass} required value={deviceId} disabled={locked||!!editor.record} onChange={event=>chooseAccessDevice(event.target.value)}><option value="">Choose an outlet assignment</option>{configuration?.devices.map(device=><option key={device.id} value={device.id}>{device.label}{!device.active?' (inactive)':''}</option>)}</select></label>}
        {(editor?.kind==='menu'||editor?.kind==='access')&&<fieldset className="space-y-2 rounded-lg border border-zinc-700 p-3"><legend className="px-1 text-sm font-semibold">Preparation stations</legend><p className="text-xs text-zinc-400">{editor.kind==='menu'?'Choose one to eight stations.':'Choose up to eight stations. Clear every station to remove access.'}</p>{configuration?.stations.filter(station=>station.active||stationIds.includes(station.id)).map(station=><label key={station.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={stationIds.includes(station.id)} onChange={event=>changeStations(station.id,event.target.checked)} disabled={locked||!stationIds.includes(station.id)&&stationIds.length>=8}/><span>{station.name}{!station.active?' (inactive)':''}</span></label>)}{!configuration?.stations.length&&<p className="text-sm text-amber-200">Add a preparation station first.</p>}</fieldset>}
        {editor?.kind!=='access'&&<label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/>{editor?.kind==='menu'?'Available for ordering':'Active'}</label>}
        </fieldset>
        {error&&<p role="alert" className="text-sm text-rose-200">{error}</p>}
        {unknownId&&<div role="alert" className="space-y-2 rounded-lg border border-amber-700 p-3 text-sm text-amber-100"><p>This setup change is unconfirmed. Keep these details while its status is checked.</p><button type="button" className={actionClass} disabled={busy||!online} onClick={()=>void recover()}>Check setup change status</button></div>}
      </form>
    </ResponsiveDialog>
  </div>;
}
