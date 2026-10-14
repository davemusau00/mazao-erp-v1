import React, { useEffect, useRef, useState } from 'react';
import { Building2, CheckCircle2, CircleAlert, ClipboardCheck, ReceiptText, Settings2 } from 'lucide-react';
import { apiClient, type BackendBusinessConfigurationInput, type BackendCommand, type BackendConfiguration, type BackendOutletConfigurationInput } from '../../services/apiClient';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import './BackendManageWorkspace.css';

type Section='business'|'outlet'|'capabilities'|'readiness';
const capabilityLabels:Record<string,string>={commerce:'Sales and customer accounts',inventory:'Inventory',retail:'Retail workspace',hospitality:'Rooms and guest stays'};

function businessInput(configuration:BackendConfiguration):BackendBusinessConfigurationInput {
  const {id:_,version:__,...fields}=configuration.business;
  return fields;
}
function outletInput(configuration:BackendConfiguration):BackendOutletConfigurationInput {
  const {id:_,version:__,...fields}=configuration.outlet;
  return fields;
}

export function BackendManageWorkspace() {
  const session=apiClient.getSession()!;
  const canEdit=session.user.permissions.includes('config.manage');
  const [section,setSection]=useState<Section>('business');
  const [configuration,setConfiguration]=useState<BackendConfiguration|null>(null);
  const [business,setBusiness]=useState<BackendBusinessConfigurationInput|null>(null);
  const [outlet,setOutlet]=useState<BackendOutletConfigurationInput|null>(null);
  const [capabilities,setCapabilities]=useState<string[]>([]);
  const [taxRate,setTaxRate]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [conflict,setConflict]=useState(false);
  const [unknownId,setUnknownId]=useState('');
  const [recoveryChecked,setRecoveryChecked]=useState(false);
  const [recoveryError,setRecoveryError]=useState('');
  const pending=useRef<BackendCommand|null>(null);
  const mounted=useRef(true);
  const editingBlocked=!canEdit||busy||Boolean(unknownId)||conflict||!recoveryChecked;

  const load=async()=>{
    setLoading(true);setError('');
    try {
      const result=await apiClient.getConfiguration();
      setConfiguration(result.configuration);
      setBusiness(businessInput(result.configuration));setOutlet(outletInput(result.configuration));
      setCapabilities(result.configuration.capabilities);
      const bps=result.configuration.business.taxPolicy.defaultRateBps;
      setTaxRate(`${Math.floor(bps/100)}.${String(bps%100).padStart(2,'0')}`);
      setDirty(false);setConflict(false);
    } catch(cause){setError(cause instanceof Error?cause.message:'Business settings could not be loaded.');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);
  const loadRecovery=async()=>{
    setRecoveryChecked(false);setRecoveryError('');
    try {
      const records=await apiClient.listRecoverableCommands(session.tenant.id);
      const unresolved=records.find(record=>record.command.type.startsWith('configuration.')&&record.command.deviceId===session.deviceId);
      if(!mounted.current)return;
      if(unresolved){
        pending.current=unresolved.command;setUnknownId(unresolved.command.commandId);
        setNotice('A settings command is awaiting server confirmation. Check its status before changing settings.');
      }
      setRecoveryChecked(true);
    } catch(cause){if(mounted.current)setRecoveryError(cause instanceof Error?cause.message:'Command recovery could not be checked.');}
  };
  useEffect(()=>{
    mounted.current=true;void loadRecovery();
    return()=>{mounted.current=false;};
  },[session.tenant.id,session.deviceId]);
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    const beforeNavigate=(event:Event)=>{if(dirty&&!window.confirm('Discard unsaved business settings and leave this page?'))event.preventDefault();};
    window.addEventListener('beforeunload',beforeUnload);window.addEventListener('mazao:before-navigate',beforeNavigate);
    return()=>{window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('mazao:before-navigate',beforeNavigate);};
  },[dirty]);

  const complete=async(result:{status:string;message?:string})=>{
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){pending.current=null;setUnknownId('');}
    if(result.status==='CONFIRMED'){
      setNotice('Settings saved and confirmed by the server.');
      await load();await apiClient.restore();
    } else if(result.status==='CONFLICT') {
      setConflict(true);setNotice(result.message??'These settings changed on another device. Reload the server settings and review your changes before saving again.');
    } else if(result.status==='REJECTED') {
      setError(result.message??'The server rejected these settings. Review the fields before submitting another change.');
    } else {
      setUnknownId(pending.current?.commandId??'');setNotice('The server has not confirmed this change. Check the original command status.');
    }
  };

  const send=async(command:BackendCommand)=>{
    if(!canEdit)return;
    pending.current=command;setBusy(true);setError('');setNotice('');
    try{await complete(await apiClient.submitCommand(command));}
    catch(cause){
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error?cause.message:'The save outcome is unknown. Check the command status before retrying.');
    } finally{setBusy(false);}
  };
  const command=(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>):BackendCommand=>({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
  const saveBusiness=async(event:React.FormEvent)=>{
    event.preventDefault();if(!business||!configuration||editingBlocked)return;
    if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(taxRate)){setError('Enter a tax percentage from 0 to 100 with up to two decimal places.');return;}
    const [whole,fraction='']=taxRate.split('.');
    const rate=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
    if(rate>10000){setError('The tax percentage cannot exceed 100.');return;}
    await send(command('configuration.business.update',{...business,taxPolicy:{...business.taxPolicy,defaultRateBps:rate}},{['business:'+configuration.business.id]:configuration.business.version}));
  };
  const saveOutlet=async(event:React.FormEvent)=>{
    event.preventDefault();if(!outlet||!configuration||editingBlocked)return;
    await send(command('configuration.outlet.update',outlet,{['outlet:'+configuration.outlet.id]:configuration.outlet.version}));
  };
  const saveCapabilities=async()=>{
    if(!configuration||editingBlocked)return;
    await send(command('configuration.capabilities.update',{capabilities},{['business:'+configuration.business.id]:configuration.business.version}));
  };
  const checkStatus=async()=>{
    if(!pending.current)return;
    setBusy(true);setError('');
    try {
      const result=await apiClient.checkCommandStatus(pending.current.commandId);
      await complete({status:result.status,message:typeof result.response?.message==='string'?result.response.message:undefined});
    } catch(cause){setError(cause instanceof Error?cause.message:'Status lookup failed. The original command remains retained.');}
    finally{setBusy(false);}
  };
  const changeSection=(next:Section)=>{
    if(next===section)return;
    if(dirty&&!window.confirm('Discard unsaved settings before opening another settings section?'))return;
    if(dirty&&configuration){setBusiness(businessInput(configuration));setOutlet(outletInput(configuration));setCapabilities(configuration.capabilities);const bps=configuration.business.taxPolicy.defaultRateBps;setTaxRate(`${Math.floor(bps/100)}.${String(bps%100).padStart(2,'0')}`);setDirty(false);}
    setSection(next);setError('');
  };
  const editBusiness=(field:keyof BackendBusinessConfigurationInput,value:string)=>{setBusiness(previous=>previous?{...previous,[field]:value}:previous);setDirty(true);};
  const editOutlet=(field:keyof BackendOutletConfigurationInput,value:string)=>{setOutlet(previous=>previous?{...previous,[field]:value}:previous);setDirty(true);};
  const businessField=(label:string,field:Exclude<keyof BackendBusinessConfigurationInput,'taxPolicy'>,options:{type?:string;maxLength?:number;required?:boolean;disabled?:boolean}={})=><label className="form-field"><span>{label}</span><input className="min-h-11" value={business?.[field]??''} onChange={event=>editBusiness(field,event.target.value)} disabled={editingBlocked||options.disabled} type={options.type??'text'} maxLength={options.maxLength??200} required={options.required}/></label>;
  const outletField=(label:string,field:keyof BackendOutletConfigurationInput,options:{type?:string;required?:boolean}={})=><label className="form-field"><span>{label}</span><input className="min-h-11" value={outlet?.[field]??''} onChange={event=>editOutlet(field,event.target.value)} disabled={editingBlocked} type={options.type??'text'} maxLength={200} required={options.required}/></label>;

  return <div className="page-stack configuration-workspace">
    <WorkspaceHeading eyebrow="BUSINESS ADMINISTRATION" title="Manage your business" description="Business identity, outlet settings, receipts and available services." action={<span className="text-xs text-zinc-400">{canEdit?'Administrator access':'Read access'}</span>}/>
    <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
      {([['business','Business',Building2],['outlet','Outlet and receipts',ReceiptText],['capabilities','Capabilities',Settings2],['readiness','Setup checklist',ClipboardCheck]] as const).map(([id,label,Icon])=><button key={id} type="button" aria-current={section===id?'page':undefined} onClick={()=>changeSection(id)} className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${section===id?'border-blue-500 bg-blue-500/10 text-blue-200':'border-zinc-700 text-zinc-300'}`}><Icon size={16}/>{label}</button>)}
    </nav>
    {!canEdit&&<p className="rounded-lg border border-zinc-700 p-3 text-sm text-zinc-300">Your account can review these settings. An administrator can change them.</p>}
    {!recoveryChecked&&<div role={recoveryError?'alert':'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{recoveryError||'Checking retained command evidence before allowing settings changes.'}{recoveryError&&<button type="button" className="ml-3 min-h-11 underline" onClick={()=>void loadRecovery()}>Retry command recovery</button>}</div>}
    {error&&<div role="alert" className="rounded-lg border border-rose-700 bg-rose-950/20 p-4 text-sm text-rose-200">{error}{!configuration&&<button type="button" className="ml-3 min-h-11 underline" onClick={()=>void load()}>Retry loading settings</button>}</div>}
    {notice&&<div role={unknownId||conflict?'alert':'status'} className={`rounded-lg border p-4 text-sm ${unknownId||conflict?'border-amber-700 text-amber-200':'border-emerald-800 text-emerald-200'}`}>{notice}</div>}
    {unknownId&&<section className="workflow-panel" aria-label="Settings command recovery"><h2 className="text-lg font-semibold">Check settings save status</h2><p className="mt-2 text-sm text-zinc-300">The exact command is retained on this device. Settings stay locked until its outcome is confirmed.</p><p className="mt-2 break-all font-mono text-xs text-zinc-400">Command {unknownId}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" className="primary-action min-h-11" disabled={busy} onClick={()=>void checkStatus()}>Check status</button><button type="button" className="secondary-action min-h-11" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry original command</button></div></section>}
    {conflict&&<button type="button" className="secondary-action min-h-11 self-start" onClick={()=>{if(!dirty||window.confirm('Reload current server settings? Unsaved changes will be discarded.'))void load();}}>Reload server settings</button>}
    {loading&&!configuration&&<p role="status" className="p-6 text-zinc-300">Loading business settings…</p>}
    {configuration&&business&&outlet&&<>
      {section==='business'&&<form onSubmit={saveBusiness} className="workflow-panel"><div className="panel-heading"><div><h2>Business profile</h2><p>Changes apply to this business across its outlets.</p></div><Building2 size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-4 md:grid-cols-2">
        {businessField('Business name','name',{required:true})}{businessField('Legal business name','legalName')}
        {businessField('Registration number','registrationNumber')}{businessField('Tax registration number','taxRegistrationNumber')}
        {businessField('Currency (ISO code)','currency',{required:true,maxLength:3,disabled:configuration.currencyLocked})}{businessField('Business time zone','timeZone',{required:true})}
        {configuration.currencyLocked&&<p className="text-xs text-zinc-400 md:col-span-2">Currency is fixed because this business already has monetary records.</p>}
        {businessField('Business address','address')}{businessField('Contact phone','phone',{type:'tel'})}
        {businessField('Contact email','email',{type:'email'})}{businessField('Website','website',{type:'url'})}
        {businessField('Logo image URL','logoUrl',{type:'url',maxLength:1000})}
        <label className="form-field"><span id="business-receipt-header-label">Receipt header</span><textarea aria-labelledby="business-receipt-header-label" value={business.receiptHeader} maxLength={500} rows={3} onChange={event=>editBusiness('receiptHeader',event.target.value)}/></label>
        <label className="form-field"><span id="business-receipt-footer-label">Receipt footer</span><textarea aria-labelledby="business-receipt-footer-label" value={business.receiptFooter} maxLength={500} rows={3} onChange={event=>editBusiness('receiptFooter',event.target.value)}/></label>
        <div className="md:col-span-2 mt-2 border-t border-zinc-700 pt-4"><h3 className="font-semibold">Tax policy</h3><p className="mt-1 text-sm text-zinc-400">Prices exclude tax. The default applies to newly created items and rooms; existing item rates and posted transactions keep their original rates.</p></div>
        <label className="form-field"><span id="default-tax-label">Default tax rate (%)</span><input aria-labelledby="default-tax-label" className="min-h-11" inputMode="decimal" value={taxRate} onChange={event=>{setTaxRate(event.target.value);setDirty(true);}} required aria-describedby="tax-rate-detail"/><small id="tax-rate-detail">Up to two decimal places; stored as integer basis points.</small></label>
        <label className="form-field"><span>Tax label</span><input className="min-h-11" value={business.taxPolicy.label} maxLength={60} onChange={event=>{setBusiness({...business,taxPolicy:{...business.taxPolicy,label:event.target.value}});setDirty(true);}} required/></label>
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={business.taxPolicy.reviewed} onChange={event=>{setBusiness({...business,taxPolicy:{...business.taxPolicy,reviewed:event.target.checked}});setDirty(true);}}/>I have reviewed this business tax policy</label>
      </fieldset><div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-700 pt-4"><span className="text-xs text-zinc-400">{dirty?'Unsaved changes':`Server version ${configuration.business.version}`}</span><button type="submit" className="primary-action min-h-11" disabled={editingBlocked||!dirty}>{busy?'Saving…':'Save business settings'}</button></div></form>}
      {section==='outlet'&&<form onSubmit={saveOutlet} className="workflow-panel"><div className="panel-heading"><div><h2>Current outlet</h2><p>Settings for {configuration.outlet.name}. Blank receipt and contact fields use business defaults.</p></div><ReceiptText size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-4 md:grid-cols-2">{outletField('Outlet name','name',{required:true})}{outletField('Outlet time zone','timeZone',{required:true})}{outletField('Outlet address','address')}{outletField('Outlet phone','phone',{type:'tel'})}{outletField('Outlet email','email',{type:'email'})}<label className="form-field"><span id="outlet-receipt-header-label">Outlet receipt header</span><textarea aria-labelledby="outlet-receipt-header-label" value={outlet.receiptHeader} maxLength={500} rows={3} onChange={event=>editOutlet('receiptHeader',event.target.value)}/></label><label className="form-field"><span id="outlet-receipt-footer-label">Outlet receipt footer</span><textarea aria-labelledby="outlet-receipt-footer-label" value={outlet.receiptFooter} maxLength={500} rows={3} onChange={event=>editOutlet('receiptFooter',event.target.value)}/></label></fieldset><div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-700 pt-4"><span className="text-xs text-zinc-400">{dirty?'Unsaved changes':`Server version ${configuration.outlet.version}`}</span><button type="submit" className="primary-action min-h-11" disabled={editingBlocked||!dirty}>{busy?'Saving…':'Save outlet settings'}</button></div></form>}
      {section==='capabilities'&&<section className="workflow-panel"><div className="panel-heading"><div><h2>Business capabilities</h2><p>Enable the services this business uses.</p></div><Settings2 size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-3 sm:grid-cols-2">{configuration.supportedCapabilities.map(capability=><label key={capability} className="flex min-h-14 items-center gap-3 rounded-lg border border-zinc-700 px-4 py-3"><input type="checkbox" checked={capabilities.includes(capability)} onChange={event=>{setCapabilities(previous=>event.target.checked?[...previous,capability]:previous.filter(value=>value!==capability));setDirty(true);}}/><span className="text-sm">{capabilityLabels[capability]??capability}</span></label>)}</fieldset><p className="mt-4 text-sm text-zinc-400">Sales requires inventory. Retail requires sales and inventory. Rooms requires sales. Turning off a capability keeps its business history.</p><div className="mt-5 flex justify-end"><button type="button" className="primary-action min-h-11" disabled={editingBlocked||!dirty} onClick={()=>void saveCapabilities()}>{busy?'Saving…':'Save capabilities'}</button></div></section>}
      {section==='readiness'&&<section className="workflow-panel"><div className="panel-heading"><div><h2>First sale checklist</h2><p>{configuration.readiness.readyForFirstSale?'This outlet is ready for its first sale.':'Complete the remaining setup checks before selling.'}</p></div><ClipboardCheck size={18}/></div><div className="grid gap-3">{configuration.readiness.checks.map(check=><div key={check.key} className="flex items-start gap-3 rounded-lg border border-zinc-700 p-4">{check.complete?<CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-300"/>:<CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-300"/>}<div><h3 className="text-sm font-semibold">{check.label}<span className="ml-2 font-normal text-zinc-400">{check.complete?'Complete':'Needs attention'}</span></h3><p className="mt-1 text-sm text-zinc-400">{check.detail}</p></div></div>)}</div><button type="button" className="secondary-action min-h-11 mt-4" disabled={loading||busy} onClick={()=>void load()}>Refresh setup checks</button></section>}
    </>}
  </div>;
}
