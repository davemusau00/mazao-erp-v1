import { formatBasisPoints, permissionLabel, roleLabel, setupCheckLabel, setupCheckDetail } from '../../utils/presentation';
import React, { useEffect, useRef, useState } from 'react';
import { Building2, CheckCircle2, CircleAlert, ClipboardCheck, ContactRound, FileUp, MonitorCog, ReceiptText, Settings2, Shield, Wrench, Truck, WifiOff, CreditCard, PackageSearch, Banknote, CalendarDays } from 'lucide-react';
import { apiClient, ApiClientError, type BackendBusinessConfigurationInput, type BackendCommand, type BackendConfiguration, type BackendOutletConfigurationInput, type BackendStockSalePolicy } from '../../services/apiClient';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { canDiscover, managementFeatureState, managementFeatures, type ManagementFeatureId } from '../../app/featureRegistry';
import type { WorkspaceId } from '../../types/ui';
import type { AccountingArea } from '../../types/accounting';
import { StaffAccessWorkspace } from './StaffAccessWorkspace';
import { safeRasterImageSource } from '../../utils/html';
import './BackendManageWorkspace.css';

type Section='overview'|'business'|'outlet'|'capabilities'|'readiness'|'permissions'|'staff'|'devices'|'stockExceptions';
type ImageDraft={mode:'keep'|'remove'|'replace';draftId?:string;dataUrl?:string};
const capabilityLabels:Record<string,string>={commerce:'Sales and customer accounts',inventory:'Inventory',retail:'Retail workspace',hospitality:'Rooms and guest stays',restaurant:'Restaurant setup and menu routing'};
const managementIcons:Record<ManagementFeatureId,React.ReactNode>={business:<Building2/>,staff:<ContactRound/>,permissions:<Shield/>,devices:<MonitorCog/>,imports:<FileUp/>,assets:<Wrench/>,suppliers:<Truck/>,expenses:<Banknote/>,periods:<CalendarDays/>,offline:<WifiOff/>,payments:<CreditCard/>,capabilities:<Settings2/>,readiness:<ClipboardCheck/>,outlet:<ReceiptText/>,stockExceptions:<PackageSearch/>};

function businessInput(configuration:BackendConfiguration):BackendBusinessConfigurationInput {
  const {id:_,version:__,...fields}=configuration.business;
  return fields;
}
function outletInput(configuration:BackendConfiguration):BackendOutletConfigurationInput {
  const {id:_,version:__,active:___,...fields}=configuration.outlet;
  return fields;
}

export function BackendManageWorkspace({initialSection='overview',onNavigate,onOpenImport,onOpenAccounting}:{initialSection?:Section;onNavigate:(workspace:WorkspaceId)=>boolean|void;onOpenImport:()=>void;onOpenAccounting:(area:AccountingArea)=>void}) {
  const session=apiClient.getSession()!;
  const canEdit=session.user.permissions.includes('config.manage');
  const canConfigureStockExceptions=session.user.permissions.includes('inventory.shortfall.configure');
  const canReadStockPolicy=session.user.permissions.some(permission=>['commerce.sell','inventory.shortfall.configure','inventory.shortfall.view'].includes(permission));
  const [section,setSection]=useState<Section>(initialSection);
  const [configuration,setConfiguration]=useState<BackendConfiguration|null>(null);
  const [selectedOutletId,setSelectedOutletId]=useState(session.outlet.id);
  const selectedOutletRef=useRef(session.outlet.id);
  const [stockPolicy,setStockPolicy]=useState<BackendStockSalePolicy|null>(null);
  const [stockPolicyEnabled,setStockPolicyEnabled]=useState(false);
  const [allowZeroReferenceCost,setAllowZeroReferenceCost]=useState(true);
  const [business,setBusiness]=useState<BackendBusinessConfigurationInput|null>(null);
  const [outlet,setOutlet]=useState<BackendOutletConfigurationInput|null>(null);
  const [capabilities,setCapabilities]=useState<string[]>([]);
  const [taxRate,setTaxRate]=useState('');
  const [goLiveReason,setGoLiveReason]=useState('');
  const [goLiveReviewed,setGoLiveReviewed]=useState(false);
  const [newOutletName,setNewOutletName]=useState('');
  const [newOutletTimeZone,setNewOutletTimeZone]=useState(session.tenant.timeZone);
  const [outletStatusReason,setOutletStatusReason]=useState('');
  const [outletTaxOverride,setOutletTaxOverride]=useState(false);
  const [outletTaxRate,setOutletTaxRate]=useState('0.00');
  const [outletTaxLabel,setOutletTaxLabel]=useState('Tax');
  const [outletTaxReviewed,setOutletTaxReviewed]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [notice,setNotice]=useState('');
  const [conflict,setConflict]=useState(false);
  const [unknownId,setUnknownId]=useState('');
  const [recoveryChecked,setRecoveryChecked]=useState(false);
  const [recoveryError,setRecoveryError]=useState('');
  const [logoDraft,setLogoDraft]=useState<ImageDraft>({mode:'keep'});
  const [receiptQrDraft,setReceiptQrDraft]=useState<ImageDraft>({mode:'keep'});
  const pending=useRef<BackendCommand|null>(null);
  const mounted=useRef(true);
  const loadController=useRef<AbortController|null>(null);
  const loadGeneration=useRef(0);
  const editingBlocked=!canEdit||busy||Boolean(unknownId)||conflict||!recoveryChecked;
  const stockPolicyAccessMessage=!(configuration?.capabilities??session.tenant.capabilities).includes('inventory')
    ?'Enable inventory to review stock exception settings.'
    :!canReadStockPolicy?'Your account cannot review stock exception settings.':'';

  const load=async()=>{
    loadController.current?.abort();const controller=new AbortController();loadController.current=controller;const generation=++loadGeneration.current;
    setLoading(true);setError('');setLoadError('');
    try {
      const result=await apiClient.getConfiguration(controller.signal);
      const policy=result.configuration.capabilities.includes('inventory')&&canReadStockPolicy
        ?(await apiClient.getStockSalePolicy(controller.signal)).policy:null;
      if(!mounted.current||generation!==loadGeneration.current)return;
      const selectedOutlet=result.configuration.outlets.find(item=>item.id===selectedOutletRef.current)??result.configuration.outlet;
      selectedOutletRef.current=selectedOutlet.id;setSelectedOutletId(selectedOutlet.id);
      setConfiguration(result.configuration);
      setStockPolicy(policy);setStockPolicyEnabled(policy?.enabled??false);setAllowZeroReferenceCost(policy?.allowZeroReferenceCost??true);
      setBusiness(businessInput(result.configuration));setOutlet(outletInput({...result.configuration,outlet:selectedOutlet}));
      const selectedTax=selectedOutlet.taxPolicy??result.configuration.business.taxPolicy;
      setOutletTaxOverride(Boolean(selectedOutlet.taxPolicy));setOutletTaxRate(`${Math.floor(selectedTax.defaultRateBps/100)}.${String(selectedTax.defaultRateBps%100).padStart(2,'0')}`);setOutletTaxLabel(selectedTax.label);setOutletTaxReviewed(selectedOutlet.taxPolicy?.reviewed??false);
      setLogoDraft({mode:'keep'});setReceiptQrDraft({mode:'keep'});
      setCapabilities(result.configuration.capabilities);
      const bps=result.configuration.business.taxPolicy.defaultRateBps;
      setTaxRate(`${Math.floor(bps/100)}.${String(bps%100).padStart(2,'0')}`);
      setDirty(false);setConflict(false);
    } catch(cause){if(!(cause instanceof ApiClientError&&cause.code==='REQUEST_CANCELLED')&&mounted.current&&generation===loadGeneration.current)setLoadError(cause instanceof Error?cause.message:'Business settings could not be loaded.');}
    finally{if(mounted.current&&generation===loadGeneration.current)setLoading(false);if(loadController.current===controller)loadController.current=null;}
  };

  useEffect(()=>{mounted.current=true;selectedOutletRef.current=session.outlet.id;setSelectedOutletId(session.outlet.id);setNewOutletTimeZone(session.tenant.timeZone);void load();return()=>{mounted.current=false;loadController.current?.abort();};},[session.tenant.id,session.outlet.id]);
  useEffect(()=>{setSection(initialSection);},[initialSection]);
  const loadRecovery=async()=>{
    setRecoveryChecked(false);setRecoveryError('');
    try {
      const records=await apiClient.listRecoverableCommands(session.tenant.id);
      const unresolved=records.find(record=>record.command.type.startsWith('configuration.')&&record.command.deviceId===session.deviceId);
      if(!mounted.current)return;
      if(unresolved){
        pending.current=unresolved.command;setUnknownId(unresolved.command.commandId);
        setNotice('A settings change needs review. Check its status before making another change.');
      }
      setRecoveryChecked(true);
    } catch(cause){if(mounted.current)setRecoveryError(cause instanceof Error?cause.message:'We could not check for unfinished actions.');}
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
    const completedType=pending.current?.type;
    if(['CONFIRMED','REJECTED','CONFLICT'].includes(result.status)){pending.current=null;setUnknownId('');}
    if(result.status==='CONFIRMED'){
      // The submitted edits are committed even while the projection refreshes.
      setDirty(false);
      setNotice(completedType==='configuration.go_live.approve'?'Go-live review recorded. Ordinary workspace access is now enabled.':'Settings saved.');
      setGoLiveReason('');setGoLiveReviewed(false);
      if(completedType==='configuration.outlet.create')setNewOutletName('');
      if(completedType==='configuration.outlet.set_active')setOutletStatusReason('');
      await load();await apiClient.restore();
    } else if(result.status==='CONFLICT') {
      setConflict(true);setNotice(result.message??'These settings changed elsewhere. Reload settings and review your changes before saving again.');
    } else if(result.status==='REJECTED') {
      setError(result.message??'Settings were not saved. Review the fields before trying again.');
    } else {
      setUnknownId(pending.current?.commandId??'');setNotice('We could not confirm this change. Check its status before trying again.');
    }
  };

  const send=async(command:BackendCommand)=>{
    if(!canEdit)return;
    pending.current=command;setBusy(true);setError('');setNotice('');
    try{await complete(await apiClient.submitCommand(command));}
    catch(cause){
      setUnknownId(command.commandId);
      setNotice(cause instanceof Error?cause.message:'We could not confirm this change. Check its status before trying again.');
    } finally{setBusy(false);}
  };
  const command=(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>):BackendCommand=>({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
  const saveBusiness=async(event:React.FormEvent)=>{
    event.preventDefault();if(!business||!configuration||editingBlocked)return;
    if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(taxRate)){setError('Enter a tax percentage from 0 to 100 with up to two decimal places.');return;}
    const [whole,fraction='']=taxRate.split('.');
    const rate=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
    if(rate>10000){setError('The tax percentage cannot exceed 100.');return;}
    setBusy(true);setError('');
    try {
      const logoAsset=logoDraft.mode==='replace'&&logoDraft.draftId&&logoDraft.dataUrl?await apiClient.stageConfigurationAsset('logo',logoDraft.draftId,logoDraft.dataUrl):undefined;
      const qrAsset=receiptQrDraft.mode==='replace'&&receiptQrDraft.draftId&&receiptQrDraft.dataUrl?await apiClient.stageConfigurationAsset('receipt_qr',receiptQrDraft.draftId,receiptQrDraft.dataUrl):undefined;
      const {logoUrl,receiptQrImage,...fields}=business;
      const imageActions={
        logo:logoDraft.mode==='replace'&&logoAsset?{mode:'replace',assetId:logoAsset.id}:logoDraft.mode==='remove'?{mode:'remove'}:{mode:'keep'},
        receiptQr:receiptQrDraft.mode==='replace'&&qrAsset?{mode:'replace',assetId:qrAsset.id}:receiptQrDraft.mode==='remove'?{mode:'remove'}:{mode:'keep'},
      };
      await send(command('configuration.business.update',{...fields,logoUrl:/^https:\/\//i.test(logoUrl)?logoUrl:'',receiptQrImage:'',imageActions,taxPolicy:{...business.taxPolicy,defaultRateBps:rate}},{['business:'+configuration.business.id]:configuration.business.version}));
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'Image upload did not finish. Retry with the same image; settings were not sent.');
    } finally {setBusy(false);}
  };
  const saveOutlet=async(event:React.FormEvent)=>{
    event.preventDefault();if(!outlet||!configuration||editingBlocked)return;
    let taxPolicy:{calculation:'exclusive';defaultRateBps:number;label:string;reviewed:boolean}|null=null;
    if(outletTaxOverride){
      if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(outletTaxRate)){setError('Enter an outlet tax percentage from 0 to 100 with up to two decimal places.');return;}
      const [whole,fraction='']=outletTaxRate.split('.');const rate=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
      if(rate>10000){setError('The outlet tax percentage cannot exceed 100.');return;}
      taxPolicy={calculation:'exclusive',defaultRateBps:rate,label:outletTaxLabel,reviewed:outletTaxReviewed};
    }
    await send(command('configuration.outlet.update',{...outlet,outletId:selectedOutletId,taxPolicy},{['outlet:'+selectedOutletId]:configuration.outlets.find(item=>item.id===selectedOutletId)?.version??configuration.outlet.version}));
  };
  const createOutlet=async(event:React.FormEvent)=>{
    event.preventDefault();if(!configuration||editingBlocked)return;
    await send(command('configuration.outlet.create',{name:newOutletName,timeZone:newOutletTimeZone,address:'',phone:'',email:'',receiptHeader:'',receiptFooter:''},{['business:'+configuration.business.id]:configuration.business.version}));
  };
  const changeOutletStatus=async(target:BackendConfiguration['outlet'])=>{
    if(!configuration||editingBlocked||!outletStatusReason.trim())return;
    await send(command('configuration.outlet.set_active',{outletId:target.id,active:!target.active,reason:outletStatusReason.trim()},{['outlet:'+target.id]:target.version}));
  };
  const selectOutlet=(outletId:string)=>{
    if(outletId===selectedOutletId||!configuration)return;
    if(dirty&&!window.confirm('Discard unsaved outlet settings and select another outlet?'))return;
    const target=configuration.outlets.find(item=>item.id===outletId);if(!target)return;
    selectedOutletRef.current=target.id;setSelectedOutletId(target.id);setOutlet(outletInput({...configuration,outlet:target}));
    const policy=target.taxPolicy??configuration.business.taxPolicy;setOutletTaxOverride(Boolean(target.taxPolicy));setOutletTaxRate(`${Math.floor(policy.defaultRateBps/100)}.${String(policy.defaultRateBps%100).padStart(2,'0')}`);setOutletTaxLabel(policy.label);setOutletTaxReviewed(target.taxPolicy?.reviewed??false);
    setDirty(false);setConflict(false);setError('');
  };
  const saveCapabilities=async()=>{
    if(!configuration||editingBlocked)return;
    await send(command('configuration.capabilities.update',{capabilities},{['business:'+configuration.business.id]:configuration.business.version}));
  };
  const saveStockPolicy=async()=>{
    if(!stockPolicy||!canConfigureStockExceptions||editingBlocked)return;
    await send(command('configuration.stock_exception_policy.update',{enabled:stockPolicyEnabled,allowZeroReferenceCost},{['stock-sale-policy:'+session.outlet.id]:stockPolicy.version}));
  };
  const approveGoLive=async()=>{
    if(!configuration||configuration.onboarding?.status!=='SETUP'||session.user.role!=='owner'||!configuration.readiness.readyForFirstSale||!goLiveReviewed||!goLiveReason.trim()||editingBlocked)return;
    await send(command('configuration.go_live.approve',{reason:goLiveReason.trim()},{['business:'+configuration.business.id]:configuration.business.version}));
  };
  const checkStatus=async()=>{
    if(!pending.current)return;
    setBusy(true);setError('');
    try {
      const result=await apiClient.checkCommandStatus(pending.current.commandId);
      await complete({status:result.status,message:typeof result.response?.message==='string'?result.response.message:undefined});
    } catch(cause){setError(cause instanceof Error?cause.message:'We could not check status. The original action details remain saved.');}
    finally{setBusy(false);}
  };
  const changeSection=(next:Section)=>{
    if(next===section)return;
    if(!window.dispatchEvent(new Event('mazao:before-navigate',{cancelable:true})))return;
    if(dirty&&configuration){setBusiness(businessInput(configuration));const selected=configuration.outlets.find(item=>item.id===selectedOutletId)??configuration.outlet;setOutlet(outletInput({...configuration,outlet:selected}));const tax=selected.taxPolicy??configuration.business.taxPolicy;setOutletTaxOverride(Boolean(selected.taxPolicy));setOutletTaxRate(`${Math.floor(tax.defaultRateBps/100)}.${String(tax.defaultRateBps%100).padStart(2,'0')}`);setOutletTaxLabel(tax.label);setOutletTaxReviewed(selected.taxPolicy?.reviewed??false);setCapabilities(configuration.capabilities);setStockPolicyEnabled(stockPolicy?.enabled??false);setAllowZeroReferenceCost(stockPolicy?.allowZeroReferenceCost??true);const bps=configuration.business.taxPolicy.defaultRateBps;setTaxRate(`${Math.floor(bps/100)}.${String(bps%100).padStart(2,'0')}`);setDirty(false);}
    setSection(next);setError('');
  };
  const openFeature=(id:ManagementFeatureId)=>{
    const feature=managementFeatures.find(item=>item.id===id);
    if(!feature||['insufficient_permission','not_enabled','not_connected'].includes(managementFeatureState(session,feature)))return;
    if(feature.accountingArea){onOpenAccounting(feature.accountingArea);return;}
    if(feature.route){const accepted=onNavigate(feature.route);if(feature.id==='imports'&&accepted!==false)onOpenImport();return;}
    if(feature.section)changeSection(feature.section);
  };
  const editBusiness=(field:keyof BackendBusinessConfigurationInput,value:string)=>{setBusiness(previous=>previous?{...previous,[field]:value}:previous);setDirty(true);};
  const editOutlet=(field:keyof BackendOutletConfigurationInput,value:string)=>{setOutlet(previous=>previous?{...previous,[field]:value}:previous);setDirty(true);};
  const uploadBusinessImage=async(field:'logoUrl'|'receiptQrImage',file?:File)=>{
    if(!file)return;
    if(file.type!=='image/png'){setError('Choose a PNG image file.');return;}
    if(file.size>512*1024){setError('PNG images must be 512 KB or smaller.');return;}
    setError('');
    try {
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onerror=()=>reject(new Error('The PNG file could not be read.'));
        reader.onload=()=>typeof reader.result==='string'&&reader.result.startsWith('data:image/png;base64,')?resolve(reader.result):reject(new Error('The selected file is not a PNG image.'));
        reader.readAsDataURL(file);
      });
      const draft={mode:'replace' as const,draftId:crypto.randomUUID(),dataUrl};
      if(field==='logoUrl')setLogoDraft(draft);else setReceiptQrDraft(draft);setDirty(true);
    } catch(cause){setError(cause instanceof Error?cause.message:'The image file could not be read.');}
  };
  const uploadedImageField=(label:string,field:'logoUrl'|'receiptQrImage')=>{
    const value=field==='logoUrl'?(business?.logoUrl??''):(business?.receiptQrImage??'');const change=field==='logoUrl'?logoDraft:receiptQrDraft;const savedPreview=value&&safeRasterImageSource(value)?value:'';
    const preview=change.mode==='replace'?(change.dataUrl??''):change.mode==='remove'?'':savedPreview;
    const changeDraft=(next:ImageDraft)=>{if(field==='logoUrl')setLogoDraft(next);else setReceiptQrDraft(next);setDirty(true);};
    return <div className="form-field"><label htmlFor={`business-${field}-upload`}>{label} PNG</label>
      <input id={`business-${field}-upload`} aria-label={`Upload ${label.toLowerCase()} PNG`} type="file" accept="image/png" className="min-h-11" disabled={editingBlocked} onChange={event=>{void uploadBusinessImage(field,event.currentTarget.files?.[0]);event.currentTarget.value='';}} />
      <small>PNG only, up to 512 KB. Images upload separately from business settings and remain available to saved receipts.</small>
      {(preview||change.mode==='remove')&&<div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 p-3">{preview&&<img src={preview} alt={`${label} preview`} className="max-h-20 max-w-40 object-contain"/>}{change.mode==='remove'?<button type="button" className="secondary-action min-h-11" disabled={editingBlocked} onClick={()=>changeDraft({mode:'keep'})}>Keep existing image</button>:change.mode==='replace'?<button type="button" className="secondary-action min-h-11" disabled={editingBlocked} onClick={()=>changeDraft({mode:'keep'})}>Discard new image</button>:savedPreview&&<button type="button" className="secondary-action min-h-11" disabled={editingBlocked} onClick={()=>changeDraft({mode:'remove'})}>Remove image</button>}</div>}
    </div>;
  };
  const businessField=(label:string,field:Exclude<keyof BackendBusinessConfigurationInput,'taxPolicy'|'showQrOnReceipt'>,options:{type?:string;maxLength?:number;required?:boolean;disabled?:boolean}={})=><label className="form-field"><span>{label}</span><input className="min-h-11" value={business?.[field]??''} onChange={event=>editBusiness(field,event.target.value)} disabled={editingBlocked||options.disabled} type={options.type??'text'} maxLength={options.maxLength??200} required={options.required}/></label>;
  const outletField=(label:string,field:Exclude<keyof BackendOutletConfigurationInput,'taxPolicy'>,options:{type?:string;required?:boolean}={})=><label className="form-field"><span>{label}</span><input className="min-h-11" value={outlet?.[field]??''} onChange={event=>editOutlet(field,event.target.value)} disabled={editingBlocked} type={options.type??'text'} maxLength={200} required={options.required}/></label>;

  return <div className="page-stack configuration-workspace">
    <WorkspaceHeading eyebrow="BUSINESS ADMINISTRATION" title="Manage your business" description={section==='overview'?'Business details, staff access and settings.':section==='permissions'?'Review your role and the tasks your account can perform.':section==='staff'?'Staff accounts, sign-in and business access.':section==='devices'?'Staff access to business outlets.':'Business identity, outlet settings, receipts and available services.'} action={section!=='overview'&&<button type="button" className="secondary-action min-h-11" onClick={()=>changeSection('overview')}>All settings</button>}/>
    {section==='overview'&&<>
      <section className="settings-profile-card" aria-label="Current business and outlet"><div className="settings-profile-icon"><Building2/></div><div><span className="eyebrow">ACTIVE BUSINESS</span><h2>{session.tenant.name}</h2><p>{session.tenant.currency} · {session.tenant.timeZone} · {session.outlet.name}</p></div><span className="manage-feature-status">Business details</span></section>
      <div className="manage-grid" aria-label="Administration areas">{managementFeatures.filter(feature=>canDiscover(feature.discoverability,session)).map(feature=>{
        const state=managementFeatureState(session,feature);
        const disabled=state==='insufficient_permission'||state==='not_enabled'||state==='not_connected'||(!feature.route&&!feature.section);
        const status=state==='insufficient_permission'?'Requires access':state==='not_enabled'?'Not enabled':feature.status;
        const statusClass=state==='not_connected'||state==='not_enabled'||state==='insufficient_permission'?'not-connected':'manage-feature-status';
        return <button key={feature.id} type="button" className={`manage-card manage-card-button ${disabled?'manage-card-disabled':''}`} disabled={disabled} aria-disabled={disabled} title={disabled?feature.explanation:undefined} onClick={()=>openFeature(feature.id)}><div className="manage-card-icon">{managementIcons[feature.id]}</div><div><h2>{feature.title}</h2><p>{feature.description}</p>{feature.accountingArea&&<p className="mt-2 text-xs leading-5 text-zinc-400">{feature.explanation}</p>}</div><span className={statusClass}>{status}</span>{!feature.accountingArea&&<span className="sr-only">{feature.explanation}</span>}</button>;
      })}</div>
    </>}
    {section!=='overview'&&<nav aria-label="Settings sections" className="flex flex-wrap gap-2">
      {([['business','Business',Building2],['outlet','Outlet and receipts',ReceiptText],['capabilities','Capabilities',Settings2],['readiness','Setup checklist',ClipboardCheck],['permissions','My access',Shield],['staff','Staff',ContactRound],['devices','Assignments',MonitorCog],['stockExceptions','Stock exceptions',PackageSearch]] as const).map(([id,label,Icon])=><button key={id} type="button" disabled={id==='stockExceptions'&&Boolean(stockPolicyAccessMessage)} title={id==='stockExceptions'?stockPolicyAccessMessage||undefined:undefined} aria-current={section===id?'page':undefined} onClick={()=>changeSection(id)} className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${section===id?'border-blue-500 bg-blue-500/10 text-blue-200':'border-zinc-700 text-zinc-300'}`}><Icon size={16}/>{label}</button>)}
    </nav>}
    {section!=='overview'&&stockPolicyAccessMessage&&<p className="text-sm text-zinc-400">{stockPolicyAccessMessage}</p>}
    {!canEdit&&!['staff','devices'].includes(section)&&<p className="rounded-lg border border-zinc-700 p-3 text-sm text-zinc-300">Your account can review these settings. An administrator can change them.</p>}
    {!recoveryChecked&&<div role={recoveryError?'alert':'status'} className="rounded-lg border border-amber-800 p-3 text-sm text-amber-200">{recoveryError||'Checking for unfinished settings changes...'}{recoveryError&&<button type="button" className="ml-3 min-h-11 underline" onClick={()=>void loadRecovery()}>Retry status check</button>}</div>}
    {loadError&&<div role="alert" className="rounded-lg border border-rose-700 bg-rose-950/20 p-4 text-sm text-rose-200">{loadError}<button type="button" className="ml-3 min-h-11 underline" disabled={loading} onClick={()=>void load()}>{configuration?'Retry settings refresh':'Retry loading settings'}</button></div>}
    {error&&<div role="alert" className="rounded-lg border border-rose-700 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</div>}
    {notice&&<div role={unknownId||conflict?'alert':'status'} className={`rounded-lg border p-4 text-sm ${unknownId||conflict?'border-amber-700 text-amber-200':'border-emerald-800 text-emerald-200'}`}>{notice}</div>}
    {unknownId&&<section className="workflow-panel" aria-label="Settings changes needing review"><h2 className="text-lg font-semibold">Check settings save status</h2><p className="mt-2 text-sm text-zinc-300">The original action details are saved on this device. Check status before making another change.</p><details className="mt-2 text-xs text-zinc-400"><summary className="min-h-9 cursor-pointer py-2">Support reference</summary><p className="mt-2 break-all font-mono text-xs text-zinc-400">Reference {unknownId}</p></details><div className="mt-4 flex flex-wrap gap-3"><button type="button" className="primary-action min-h-11" disabled={busy} onClick={()=>void checkStatus()}>Check status</button><button type="button" className="secondary-action min-h-11" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry original action</button></div></section>}
    {conflict&&<button type="button" className="secondary-action min-h-11 self-start" onClick={()=>{if(!dirty||window.confirm('Reload current settings? Unsaved changes will be discarded.'))void load();}}>Reload settings</button>}
    {loading&&!configuration&&<p role="status" className="p-6 text-zinc-300">Loading business settings…</p>}
    {configuration&&business&&outlet&&<>
      {section==='business'&&<form onSubmit={saveBusiness} className="workflow-panel"><div className="panel-heading"><div><h2>Business profile</h2><p>Changes apply to this business across its outlets.</p></div><Building2 size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-4 md:grid-cols-2">
        {businessField('Business name','name',{required:true})}{businessField('Legal business name','legalName')}
        {businessField('Registration number','registrationNumber')}{businessField('Tax registration number','taxRegistrationNumber')}
        {businessField('Currency (ISO code)','currency',{required:true,maxLength:3,disabled:configuration.currencyLocked})}{businessField('Business time zone','timeZone',{required:true})}
        {configuration.currencyLocked&&<p className="text-xs text-zinc-400 md:col-span-2">Currency is fixed because this business already has monetary records.</p>}
        {businessField('Business address','address')}{businessField('Contact phone','phone',{type:'tel'})}
        {businessField('Contact email','email',{type:'email'})}{businessField('Website','website',{type:'url'})}
        {!business.logoUrl.startsWith('data:')&&!business.logoUrl.startsWith('/api/v1/configuration/assets/')&&businessField('Logo image URL','logoUrl',{type:'url',maxLength:2048})}{uploadedImageField('Business logo','logoUrl')}
        {uploadedImageField('Payment QR','receiptQrImage')}<label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={business.showQrOnReceipt} onChange={event=>{setBusiness({...business,showQrOnReceipt:event.target.checked});setDirty(true);}}/>Show payment QR on new receipts</label>
        <label className="form-field"><span id="business-receipt-header-label">Receipt header</span><textarea aria-labelledby="business-receipt-header-label" value={business.receiptHeader} maxLength={500} rows={3} onChange={event=>editBusiness('receiptHeader',event.target.value)}/></label>
        <label className="form-field"><span id="business-receipt-footer-label">Receipt footer</span><textarea aria-labelledby="business-receipt-footer-label" value={business.receiptFooter} maxLength={500} rows={3} onChange={event=>editBusiness('receiptFooter',event.target.value)}/></label>
        <div className="md:col-span-2 mt-2 border-t border-zinc-700 pt-4"><h3 className="font-semibold">Tax policy</h3><p className="mt-1 text-sm text-zinc-400">Prices exclude tax. The default applies to newly created items and rooms; existing item rates and posted transactions keep their original rates.</p></div>
        <label className="form-field"><span id="default-tax-label">Default tax rate (%)</span><input aria-labelledby="default-tax-label" className="min-h-11" inputMode="decimal" value={taxRate} onChange={event=>{setTaxRate(event.target.value);setDirty(true);}} required aria-describedby="tax-rate-detail"/><small id="tax-rate-detail">Enter up to two decimal places.</small></label>
        <label className="form-field"><span>Tax label</span><input className="min-h-11" value={business.taxPolicy.label} maxLength={60} onChange={event=>{setBusiness({...business,taxPolicy:{...business.taxPolicy,label:event.target.value}});setDirty(true);}} required/></label>
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={business.taxPolicy.reviewed} onChange={event=>{setBusiness({...business,taxPolicy:{...business.taxPolicy,reviewed:event.target.checked}});setDirty(true);}}/>I have reviewed this business tax policy</label>
      </fieldset><div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-700 pt-4"><span className="text-xs text-zinc-400">{dirty?'Unsaved changes':'Changes saved'}</span><button type="submit" className="primary-action min-h-11" disabled={editingBlocked||!dirty}>{busy?'Saving…':'Save business settings'}</button></div></form>}
      {section==='outlet'&&<section className="workflow-panel" aria-labelledby="outlet-directory-title"><div className="panel-heading"><div><h2 id="outlet-directory-title">Business outlets</h2><p>Manage outlet identity and operating time zone. Outlet status changes are reviewed and versioned.</p></div><Building2 size={18}/></div><div className="grid gap-3">{configuration.outlets.map(target=><article key={target.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-700 p-4"><div><h3 className="font-semibold">{target.name}</h3><p className="mt-1 text-sm text-zinc-400">{target.timeZone} · {target.active?'Active':'Inactive'} · v{target.version}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="secondary-action min-h-11" aria-pressed={selectedOutletId===target.id} onClick={()=>selectOutlet(target.id)}>{selectedOutletId===target.id?'Editing settings':'Edit settings'}</button>{canEdit&&<button type="button" className="secondary-action min-h-11" disabled={editingBlocked||!outletStatusReason.trim()} onClick={()=>void changeOutletStatus(target)}>{target.active?'Deactivate':'Reactivate'}</button>}</div></article>)}</div>{canEdit&&<><label className="form-field mt-4"><span>Reason for outlet status change</span><input value={outletStatusReason} onChange={event=>setOutletStatusReason(event.target.value)} maxLength={500} className="min-h-11" placeholder="Why is this outlet being opened or closed?"/></label><form onSubmit={createOutlet} className="mt-5 grid gap-4 border-t border-zinc-700 pt-5 md:grid-cols-2"><h3 className="font-semibold md:col-span-2">Add outlet</h3><label className="form-field"><span>Outlet name</span><input value={newOutletName} onChange={event=>setNewOutletName(event.target.value)} maxLength={160} required className="min-h-11"/></label><label className="form-field"><span>Outlet time zone</span><input value={newOutletTimeZone} onChange={event=>setNewOutletTimeZone(event.target.value)} maxLength={100} required className="min-h-11"/></label><button type="submit" className="primary-action min-h-11 md:col-span-2 md:justify-self-end" disabled={editingBlocked}>{busy?'Creating outlet…':'Create outlet'}</button></form></>}<p className="mt-4 text-sm text-zinc-400">An outlet cannot close while it has stock value or quantity, an open shift or count, an active stay or confirmed reservation, or an active workspace assignment. Keep an owner or administrator assignment in another active outlet. Tax policy is business-wide; blank outlet receipt fields use business defaults.</p></section>}
      {section==='outlet'&&<form onSubmit={saveOutlet} className="workflow-panel"><div className="panel-heading"><div><h2>Outlet settings: {configuration.outlets.find(item=>item.id===selectedOutletId)?.name??configuration.outlet.name}</h2><p>Settings for the selected outlet. Blank receipt and contact fields use business defaults.</p></div><ReceiptText size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-4 md:grid-cols-2">{outletField('Outlet name','name',{required:true})}{outletField('Outlet time zone','timeZone',{required:true})}{outletField('Outlet address','address')}{outletField('Outlet phone','phone',{type:'tel'})}{outletField('Outlet email','email',{type:'email'})}<label className="form-field"><span id="outlet-receipt-header-label">Outlet receipt header</span><textarea aria-labelledby="outlet-receipt-header-label" value={outlet.receiptHeader} maxLength={500} rows={3} onChange={event=>editOutlet('receiptHeader',event.target.value)}/></label><label className="form-field"><span id="outlet-receipt-footer-label">Outlet receipt footer</span><textarea aria-labelledby="outlet-receipt-footer-label" value={outlet.receiptFooter} maxLength={500} rows={3} onChange={event=>editOutlet('receiptFooter',event.target.value)}/></label><section className="grid gap-3 rounded-lg border border-zinc-700 p-4 md:col-span-2" aria-labelledby="outlet-tax-title"><div><h3 id="outlet-tax-title" className="font-semibold">Tax defaults</h3><p className="mt-1 text-sm text-zinc-400">New items, rooms and imports use this outlet rate. Existing prices and posted receipt tax stay unchanged.</p></div><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={outletTaxOverride} onChange={event=>{setOutletTaxOverride(event.target.checked);if(event.target.checked)setOutletTaxReviewed(false);setDirty(true);}}/>Set an outlet-specific default</label>{outletTaxOverride?<><label className="form-field"><span>Default tax rate (%)</span><input value={outletTaxRate} onChange={event=>{setOutletTaxRate(event.target.value);setDirty(true);}} inputMode="decimal" className="min-h-11" maxLength={6}/></label><label className="form-field"><span>Tax label</span><input value={outletTaxLabel} onChange={event=>{setOutletTaxLabel(event.target.value);setDirty(true);}} maxLength={40} className="min-h-11" required/></label><label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={outletTaxReviewed} onChange={event=>{setOutletTaxReviewed(event.target.checked);setDirty(true);}}/>I reviewed this outlet tax policy</label></>:<p className="text-sm text-zinc-300">Using the business default: {configuration.business.taxPolicy.label}, {formatBasisPoints(configuration.business.taxPolicy.defaultRateBps)}%.</p>}</section></fieldset><div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-700 pt-4"><span className="text-xs text-zinc-400">{dirty?'Unsaved changes':'Changes saved'}</span><button type="submit" className="primary-action min-h-11" disabled={editingBlocked||!dirty}>{busy?'Saving…':'Save outlet settings'}</button></div></form>}
      {section==='capabilities'&&<section className="workflow-panel"><div className="panel-heading"><div><h2>Business capabilities</h2><p>Enable the services this business uses.</p></div><Settings2 size={18}/></div><fieldset disabled={editingBlocked} className="grid gap-3 sm:grid-cols-2">{configuration.supportedCapabilities.map(capability=><label key={capability} className="flex min-h-14 items-center gap-3 rounded-lg border border-zinc-700 px-4 py-3"><input type="checkbox" checked={capabilities.includes(capability)} onChange={event=>{setCapabilities(previous=>event.target.checked?[...previous,capability]:previous.filter(value=>value!==capability));setDirty(true);}}/><span className="text-sm">{capabilityLabels[capability]??'Other business service'}</span></label>)}</fieldset><p className="mt-4 text-sm text-zinc-400">Sales supports services without inventory. Stocked goods and Retail require inventory. Retail, Rooms and Restaurant require sales. Restaurant currently supports setup only; ordering and kitchen operation remain unavailable. Turning off a capability keeps its business history.</p><div className="mt-5 flex justify-end"><button type="button" className="primary-action min-h-11" disabled={editingBlocked||!dirty} onClick={()=>void saveCapabilities()}>{busy?'Saving…':'Save capabilities'}</button></div></section>}
      {section==='stockExceptions'&&stockPolicy&&<section className="workflow-panel"><div className="panel-heading"><div><h2>Stock exception sales</h2><p>Choose whether cashiers may confirm a sale when the recorded stock balance is short at {configuration.outlet.name}.</p></div><PackageSearch size={18}/></div><p className="rounded-lg border border-zinc-700 p-3 text-sm text-zinc-300">Every exception sale requires an item by item physical stock confirmation and a reason. The recorded balance is reduced only by the quantity on hand. Remaining quantity and estimated cost stay visible for manager review.</p><fieldset disabled={editingBlocked||!canConfigureStockExceptions} className="mt-4 space-y-3"><label className="flex min-h-14 items-start gap-3 rounded-lg border border-zinc-700 px-4 py-3"><input type="checkbox" checked={stockPolicyEnabled} onChange={event=>{setStockPolicyEnabled(event.target.checked);setDirty(true);}} className="mt-1"/><span><strong className="block text-sm">Allow confirmed sales with a stock shortfall</strong><small className="mt-1 block text-xs text-zinc-400">When off, sales stop if the requested quantity exceeds recorded stock.</small></span></label><label className="flex min-h-14 items-start gap-3 rounded-lg border border-zinc-700 px-4 py-3"><input type="checkbox" checked={allowZeroReferenceCost} onChange={event=>{setAllowZeroReferenceCost(event.target.checked);setDirty(true);}} className="mt-1"/><span><strong className="block text-sm">Allow a zero reference cost</strong><small className="mt-1 block text-xs text-zinc-400">When off, a non-zero item reference cost is required to estimate provisional cost of goods sold.</small></span></label></fieldset>{!canConfigureStockExceptions&&<p className="mt-3 text-xs text-zinc-400">Your account can review this policy. An administrator can change it.</p>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-700 pt-4"><span className="text-xs text-zinc-400">{stockPolicy.updatedByName?`Last changed by ${stockPolicy.updatedByName}`:'Using the safe default: stock exception sales are off.'}</span><button type="button" className="primary-action min-h-11" disabled={editingBlocked||!canConfigureStockExceptions||!dirty} onClick={()=>void saveStockPolicy()}>{busy?'Saving…':'Save stock policy'}</button></div></section>}
      {section==='readiness'&&<section className="workflow-panel"><div className="panel-heading"><div><h2>First sale checklist</h2><p>{configuration.readiness.readyForFirstSale?'This outlet is ready for its first sale.':'Complete the remaining setup checks before selling.'}</p></div><ClipboardCheck size={18}/></div><div className="grid gap-3">{configuration.readiness.checks.map(check=><div key={check.key} className="flex items-start gap-3 rounded-lg border border-zinc-700 p-4">{check.complete?<CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-300"/>:<CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-300"/>}<div><h3 className="text-sm font-semibold">{setupCheckLabel(check.key)}<span className="ml-2 font-normal text-zinc-400">{check.complete?'Complete':'Needs attention'}</span></h3><p className="mt-1 text-sm text-zinc-400">{setupCheckDetail(check.key,check.detail)}</p></div></div>)}</div><p className="mt-4 text-sm text-zinc-400">Complete your wider business checks before starting trade.</p><button type="button" className="secondary-action min-h-11 mt-4" disabled={loading||busy} onClick={()=>void load()}>Refresh setup checks</button>
        {configuration.onboarding?.status==='SETUP'&&<section className="mt-5 rounded-lg border border-blue-800 bg-blue-950/20 p-4" aria-labelledby="go-live-review-title"><h3 id="go-live-review-title" className="font-semibold">Owner go-live review</h3><p className="mt-1 text-sm text-zinc-300">Ordinary sales and finance work stays locked until the owner reviews the saved business, tax, catalog, stock, staff and device setup.</p>{session.user.role==='owner'?<><label className="mt-3 block text-sm">Review reason<textarea value={goLiveReason} onChange={event=>setGoLiveReason(event.target.value)} maxLength={500} rows={3} className="mt-1 min-h-20 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white" placeholder="Describe what was checked before opening this business."/></label><label className="mt-3 flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={goLiveReviewed} onChange={event=>setGoLiveReviewed(event.target.checked)} className="mt-1"/><span>I reviewed the saved setup and confirm this business is ready to begin ordinary operations.</span></label><button type="button" className="primary-action mt-3 min-h-11" disabled={loading||busy||editingBlocked||!configuration.readiness.readyForFirstSale||!goLiveReviewed||!goLiveReason.trim()} onClick={()=>void approveGoLive()}>{busy?'Recording review…':'Approve go-live'}</button>{!configuration.readiness.readyForFirstSale&&<p className="mt-2 text-xs text-amber-200">Finish every checklist item before approving go-live.</p>}</>:<p className="mt-3 text-sm text-zinc-400">Only the business owner can record the go-live review.</p>}</section>}
        {configuration.onboarding?.status==='LIVE'&&<p className="mt-5 rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 text-sm text-emerald-100">Go-live review recorded{configuration.onboarding.reviewedByName?` by ${configuration.onboarding.reviewedByName}`:''}{configuration.onboarding.reviewedAt?` on ${new Date(configuration.onboarding.reviewedAt).toLocaleString()}`:''}.</p>}
        {configuration.onboarding?.status==='LEGACY_ACTIVE'&&<p className="mt-5 rounded-lg border border-zinc-700 p-3 text-sm text-zinc-400">This business was active before recorded go-live reviews were introduced.</p>}
      </section>}
      {section==='permissions'&&<section className="workflow-panel"><div className="panel-heading"><div><h2>Your access</h2><p>{roleLabel(session.user.role)} · {session.user.name}</p></div><Shield size={18}/></div><p className="text-sm text-zinc-300">These are the tasks your account can perform. Staff access is managed under Staff.</p><ul className="mt-4 grid gap-2 sm:grid-cols-2">{session.user.permissions.map(permission=><li key={permission} className="rounded-lg border border-zinc-700 px-3 py-2 font-mono text-sm">{permissionLabel(permission)}</li>)}</ul>{session.user.permissions.length===0&&<p className="mt-4 text-sm text-zinc-400">No permissions are assigned to this session.</p>}</section>}
    </>}
    {(section==='staff'||section==='devices')&&<StaffAccessWorkspace mode={section}/>}
  </div>;
}
