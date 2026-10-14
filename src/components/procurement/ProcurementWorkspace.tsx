import React, { useEffect, useRef, useState } from 'react';
import { CircleAlert, ClipboardList, FileCheck2, PackageCheck, Plus, Truck } from 'lucide-react';
import type { ProductItem } from '../../types/erp';
import { storage } from '../../services/storage';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';
import { sumDecimalStrings } from '../../utils/decimal';
import { apiClient, type BackendCommand, type BackendProduct } from '../../services/apiClient';
import { moneyInputToMinor } from '../../utils/money';

type ProcurementTab = 'orders' | 'receive' | 'suppliers' | 'payables';
interface SupplierDraft { id: string; name: string; reference: string; }
interface DeliveryLine { product: ProductItem; quantity: string; unitCost: string; }

export function ProcurementWorkspace({ initialTab = 'orders', onInitialTabConsumed }: { initialTab?: ProcurementTab; onInitialTabConsumed?: () => void }) {
  const [tab, setTab] = useState<ProcurementTab>(initialTab);
  const [suppliers, setSuppliers] = useState<SupplierDraft[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [serverSupplierName,setServerSupplierName]=useState('');
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [serverProducts,setServerProducts]=useState<BackendProduct[]>([]);
  const [serverError,setServerError]=useState('');
  const [receiptBusy,setReceiptBusy]=useState(false);
  const [receiptNotice,setReceiptNotice]=useState('');
  const [unknownReceiptId,setUnknownReceiptId]=useState<string|null>(null);
  const pendingReceipt=useRef<BackendCommand|null>(null);
  const backendSession=apiClient.getSession();
  const backendMode=!!backendSession;
  const products:ProductItem[]=backendMode?serverProducts.map(item=>({id:item.id,sku:item.sku,barcode:'',name:item.name,category:'server catalog',costPrice:(item.costPriceMinor??0)/100,sellingPrice:item.sellingPriceMinor/100,stockOnHand:Number(item.quantity),reorderPoint:0,unit:item.unit})):storage.getProducts();
  const selectedProductRecord = products.find(product => product.id === selectedProduct);
  const tabs: Array<[ProcurementTab, string]> = [['orders', 'Purchase orders'], ['receive', 'Receive delivery'], ['suppliers', 'Suppliers'], ['payables', 'Supplier balances']];
  const totalUnits = sumDecimalStrings(lines.map(line => line.quantity));
  const refreshServerProducts=async()=>{try{const items=(await apiClient.listCatalog()).items;setServerProducts(items);setServerError('');return items}catch(error){setServerError(error instanceof Error?error.message:'Could not load server catalog.');return [] as BackendProduct[]}};
  useEffect(()=>{if(backendSession){void (async()=>{const items=await refreshServerProducts();const recoverable=await apiClient.listRecoverableCommands(backendSession.tenant.id);const stored=recoverable.find(record=>record.command.type==='inventory.receive');if(!stored)return;pendingReceipt.current=stored.command;setUnknownReceiptId(stored.command.commandId);setTab('receive');const payloadLines=stored.command.payload.lines as Array<{productId:string;quantity:string;unitCostMinor:number}>;setLines(payloadLines.flatMap(line=>{const item=items.find(product=>product.id===line.productId);return item?[{product:{id:item.id,sku:item.sku,barcode:'',name:item.name,category:'server catalog',costPrice:(item.costPriceMinor??0)/100,sellingPrice:item.sellingPriceMinor/100,stockOnHand:Number(item.quantity),reorderPoint:0,unit:item.unit},quantity:line.quantity,unitCost:`${Math.floor(line.unitCostMinor/100)}.${String(line.unitCostMinor%100).padStart(2,'0')}`}]:[]}));setReference(String(stored.command.payload.documentReference??''));setServerSupplierName(String(stored.command.payload.supplierName??''));setReviewOpen(true);setReceiptNotice('An unresolved receipt is restored on this device. Check its server status before continuing.')})()}else setServerProducts([])},[backendSession?.deviceId]);
  useEffect(()=>{if(initialTab!=='orders')onInitialTabConsumed?.()},[initialTab,onInitialTabConsumed]);

  const addLine = () => {
    if (!selectedProductRecord || !quantity || Number(quantity) <= 0) return;
    if(tab==='receive'&&backendMode&&!unitCost){setReceiptNotice('Enter a unit cost before posting a delivery receipt.');return}
    setLines(previous => [...previous, { product: selectedProductRecord, quantity, unitCost }]);
    setSelectedProduct(''); setQuantity('1'); setUnitCost('');
  };
  const addSupplier = (event: React.FormEvent) => {
    event.preventDefault();
    if (!supplierName.trim()) return;
    const supplier = { id: `draft-${Date.now()}`, name: supplierName.trim(), reference: supplierReference.trim() };
    setSuppliers(previous => [...previous, supplier]); setSelectedSupplier(supplier.id); setSupplierName(''); setSupplierReference('');
  };
  const postReceipt=async()=>{
    if(!backendSession||!lines.length)return;
    let command=pendingReceipt.current;
    if(!command){
      try {
        for(const line of lines)if(!/^\d+(?:\.\d{1,6})?$/.test(line.quantity)||Number(line.quantity)<=0)throw new Error('Each received quantity must be positive with at most 6 decimal places.');
        const receiptLines=lines.map(line=>({productId:line.product.id,quantity:line.quantity,unitCostMinor:moneyInputToMinor(line.unitCost)}));
        command={protocolVersion:1,commandId:crypto.randomUUID(),tenantId:backendSession.tenant.id,deviceId:backendSession.deviceId,type:'inventory.receive',occurredAt:new Date().toISOString(),expectedVersions:{},payload:{lines:receiptLines,documentReference:reference.trim(),supplierName:serverSupplierName.trim()||suppliers.find(item=>item.id===selectedSupplier)?.name||''}};
      }catch(error){setReceiptNotice(error instanceof Error?error.message:'Receipt details are invalid.');return}
    }
    pendingReceipt.current=command;setReceiptBusy(true);setReceiptNotice('');
    try{const outcome=await apiClient.submitCommand(command);if(outcome.status==='CONFIRMED'){const value=outcome.value??{};setReceiptNotice(`Receipt confirmed: ${Number(value.lineCount??lines.length)} lines posted, ${backendSession.tenant.currency} ${(Number(value.totalMinor??0)/100).toFixed(2)} accrued.`);pendingReceipt.current=null;setUnknownReceiptId(null);setLines([]);setReference('');setServerSupplierName('');setReviewOpen(false);await refreshServerProducts()}else{pendingReceipt.current=null;setUnknownReceiptId(null);setReceiptNotice(outcome.message??`Receipt ${outcome.status.toLowerCase()}.`)}}
    catch(error){setUnknownReceiptId(command.commandId);setReceiptNotice(error instanceof Error?error.message:'Receipt outcome is unknown. Check the same command before retrying.')}
    finally{setReceiptBusy(false)}
  };
  const checkReceiptStatus=async()=>{if(!unknownReceiptId)return;try{const status=await apiClient.checkCommandStatus(unknownReceiptId);const result=status.response as {status?:string;value?:Record<string,unknown>;message?:string};if(result.status==='CONFIRMED'){const value=result.value??{};setReceiptNotice(`Server confirms receipt: ${Number(value.lineCount??lines.length)} lines, ${backendSession?.tenant.currency??''} ${(Number(value.totalMinor??0)/100).toFixed(2)}.`);setLines([]);setReference('');setServerSupplierName('');setReviewOpen(false);pendingReceipt.current=null;setUnknownReceiptId(null);await refreshServerProducts()}else if(result.status==='REJECTED'||result.status==='CONFLICT'){setReceiptNotice(result.message??`Receipt ${result.status.toLowerCase()}.`);pendingReceipt.current=null;setUnknownReceiptId(null)}else setReceiptNotice(`Receipt status: ${status.status}. Check again shortly.`)}catch(error){if((error as {status?:number}).status===404&&pendingReceipt.current){setUnknownReceiptId(null);setReceiptNotice('No command record yet; resubmitting the same receipt ID safely.');await postReceipt();return}setReceiptNotice(error instanceof Error?error.message:'Could not check receipt status.')}};

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="SUPPLY & PURCHASING" title="Purchasing" description="Prepare orders and check deliveries against the items you buy." action={<span className="local-data-badge"><span />{backendMode?'Server connection':'Draft preview'}</span>} />
    <div className="preview-notice"><PackageCheck size={16} /><span>{backendMode?'Delivery receipts post to the server and update stock atomically. Purchase orders, suppliers and payables remain local drafts.':'Supplier records and orders are temporary drafts in this screen. Delivery review does not change stock or accounts.'}</span></div>
    {serverError&&backendMode&&<div role="alert" className="preview-notice"><CircleAlert size={16}/><span>{serverError}</span><button type="button" onClick={()=>void refreshServerProducts()}>Retry catalog</button></div>}
    {receiptNotice&&<div role="status" className="preview-notice"><PackageCheck size={16}/><span>{receiptNotice}</span>{unknownReceiptId&&<button type="button" onClick={()=>void checkReceiptStatus()}>Check receipt status</button>}</div>}
    <div className="workspace-tabs" role="tablist" aria-label="Purchasing workspace">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'orders' && <div className="procurement-layout">
      <section className="workflow-panel"><div className="panel-heading"><div><h2>New purchase order</h2><p>Build a reviewable order draft.</p></div><ClipboardList size={18} /></div>
        <div className="form-grid"><label className="form-field"><span>Supplier</span><select value={selectedSupplier} onChange={event => setSelectedSupplier(event.target.value)}><option value="">Choose a draft supplier</option>{suppliers.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label><label className="form-field"><span>Order reference</span><input value={reference} onChange={event => setReference(event.target.value)} placeholder="Optional reference" /></label></div>
        <div className="line-entry-grid"><label className="form-field"><span>Item</span><select value={selectedProduct} onChange={event => setSelectedProduct(event.target.value)}><option value="">Choose item</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="form-field"><span>Quantity</span><input inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="form-field"><span>Cost / unit</span><input inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} placeholder="Optional" /></label><button type="button" className="secondary-action" onClick={addLine}><Plus size={15} /> Add item</button></div>
        <DraftLines lines={lines} onRemove={index => setLines(previous => previous.filter((_, i) => i !== index))} />
        <button className="primary-action" type="button" disabled={!lines.length || !selectedSupplier} onClick={() => setReviewOpen(true)}>Review purchase order <span>Draft only</span></button>
      </section>
      <section className="workflow-panel"><div className="panel-heading"><div><h2>Order checks</h2><p>Review before sending to a supplier.</p></div><FileCheck2 size={18} /></div><ul className="check-list"><li className={selectedSupplier ? 'complete' : ''}>Supplier selected</li><li className={lines.length ? 'complete' : ''}>At least one item added</li><li className={reference ? 'complete' : ''}>Reference recorded (optional)</li></ul><p className="muted-copy">A reviewed draft is not sent to a supplier and does not create a payable.</p></section>
    </div>}
    {tab === 'receive' && <section className="workflow-panel"><div className="panel-heading"><div><h2>Receive a delivery</h2><p>Compare the delivery with the supplier paperwork.</p></div><Truck size={18} /></div>
      <div className="form-grid">{backendMode?<label className="form-field"><span>Supplier name (receipt record)</span><input disabled={!!unknownReceiptId} maxLength={160} value={serverSupplierName} onChange={event=>setServerSupplierName(event.target.value)} placeholder="Supplier on the delivery note" /></label>:<label className="form-field"><span>Supplier</span><select value={selectedSupplier} onChange={event => setSelectedSupplier(event.target.value)}><option value="">Choose a draft supplier</option>{suppliers.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>}<label className="form-field"><span>Delivery reference</span><input disabled={!!unknownReceiptId} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} placeholder="Invoice or delivery note" /></label></div>
      <div className="line-entry-grid"><label className="form-field"><span>Received item</span><select disabled={!!unknownReceiptId} value={selectedProduct} onChange={event => setSelectedProduct(event.target.value)}><option value="">Choose item</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="form-field"><span>Quantity received</span><input disabled={!!unknownReceiptId} inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="form-field"><span>Unit cost</span><input disabled={!!unknownReceiptId} inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} placeholder={backendMode?'Required':'Optional'} /></label><button type="button" disabled={!!unknownReceiptId} className="secondary-action" onClick={addLine}><Plus size={15} /> Add line</button></div>
      <DraftLines lines={lines} onRemove={index => setLines(previous => previous.filter((_, i) => i !== index))} locked={!!unknownReceiptId} />
      <div className="review-summary"><span>{lines.length} lines · {totalUnits} units reviewed</span><button type="button" className="primary-action" disabled={!lines.length || (!selectedSupplier&&!serverSupplierName.trim()) || receiptBusy} onClick={() => setReviewOpen(true)}>Review delivery <span>{backendMode?'Ready to post':'Not posted'}</span></button></div>
    </section>}
    {tab === 'suppliers' && <div className="procurement-layout"><section className="workflow-panel"><div className="panel-heading"><div><h2>Add supplier to this preview</h2><p>Supplier details remain in memory until you leave.</p></div></div><form onSubmit={addSupplier} className="form-grid"><label className="form-field"><span>Supplier name</span><input required value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Business or contact name" /></label><label className="form-field"><span>Account reference</span><input value={supplierReference} onChange={event => setSupplierReference(event.target.value)} placeholder="Optional" /></label><button type="submit" className="secondary-action"><Plus size={15} /> Add draft supplier</button></form></section><section className="workflow-panel"><div className="panel-heading"><div><h2>Suppliers</h2><p>{suppliers.length} draft records in this session</p></div></div>{suppliers.length ? <div className="simple-record-list">{suppliers.map(supplier => <div key={supplier.id}><strong>{supplier.name}</strong><small>{supplier.reference || 'No reference'}</small><span>Draft only</span></div>)}</div> : <EmptyState title="No supplier drafts" detail="Add a supplier on the left to include it in an order preview." />}</section></div>}
    {tab === 'payables' && <section className="workflow-panel"><div className="panel-heading"><div><h2>Supplier balances</h2><p>Invoices and payments need an accounts payable service.</p></div></div><EmptyState title="No payable records available" detail="This preview does not have supplier invoice or settlement records. Delivery notes alone do not mean a supplier has been paid." /></section>}
    {reviewOpen && <div className="review-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReviewOpen(false); }}><section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="purchase-review-title"><div className="panel-heading"><div><span className="eyebrow">{backendMode&&tab==='receive'?'SERVER POST':'LOCAL PREVIEW'}</span><h2 id="purchase-review-title">Review {tab === 'receive' ? 'delivery' : 'purchase order'}</h2></div><button type="button" className="quiet-action" onClick={() => setReviewOpen(false)}>Close</button></div><p className="muted-copy">{backendMode&&tab==='receive'?serverSupplierName.trim()||'Supplier not named':selectedSupplier ? suppliers.find(item => item.id === selectedSupplier)?.name : 'No supplier selected'} · {reference || 'No reference'}</p><DraftLines lines={lines} onRemove={index => setLines(previous => previous.filter((_, i) => i !== index))} locked={!!unknownReceiptId} /><div className="preview-notice"><CircleAlert size={16} /><span>{backendMode&&tab==='receive'?'Confirming posts stock and inventory accrual in one server transaction.':'Not sent or posted. Stock, supplier balances, and the ledger have not changed.'}</span></div>{backendMode&&tab==='receive'?<button type="button" className="primary-action" disabled={receiptBusy||!!unknownReceiptId} onClick={()=>void postReceipt()}>{receiptBusy?'Posting receipt…':unknownReceiptId?'Check receipt status above':'Post reviewed receipt'}</button>:<button type="button" className="primary-action" onClick={() => setReviewOpen(false)}>Return to draft</button>}</section></div>}
  </div>;
}

function DraftLines({ lines, onRemove,locked=false }: { lines: DeliveryLine[]; onRemove: (index: number) => void;locked?:boolean }) {
  if (!lines.length) return <EmptyState title="No items added" detail="Choose products and quantities to create a review draft." />;
  return <div className="draft-lines">{lines.map((line, index) => <div key={`${line.product.id}-${index}`}><span><strong>{line.product.name}</strong><small>{line.quantity} {line.product.unit}{line.unitCost ? ` · Cost ${line.unitCost} / unit` : ''}</small></span><button type="button" disabled={locked} onClick={() => onRemove(index)}>Remove</button></div>)}</div>;
}
