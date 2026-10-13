import React, { useState } from 'react';
import { CircleAlert, ClipboardList, FileCheck2, PackageCheck, Plus, Truck } from 'lucide-react';
import type { ProductItem } from '../../types/erp';
import { storage } from '../../services/storage';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';
import { sumDecimalStrings } from '../../utils/decimal';

type ProcurementTab = 'orders' | 'receive' | 'suppliers' | 'payables';
interface SupplierDraft { id: string; name: string; reference: string; }
interface DeliveryLine { product: ProductItem; quantity: string; unitCost: string; }

export function ProcurementWorkspace() {
  const [tab, setTab] = useState<ProcurementTab>('orders');
  const [suppliers, setSuppliers] = useState<SupplierDraft[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const products = storage.getProducts();
  const selectedProductRecord = products.find(product => product.id === selectedProduct);
  const tabs: Array<[ProcurementTab, string]> = [['orders', 'Purchase orders'], ['receive', 'Receive delivery'], ['suppliers', 'Suppliers'], ['payables', 'Supplier balances']];
  const totalUnits = sumDecimalStrings(lines.map(line => line.quantity));

  const addLine = () => {
    if (!selectedProductRecord || !quantity || Number(quantity) <= 0) return;
    setLines(previous => [...previous, { product: selectedProductRecord, quantity, unitCost }]);
    setSelectedProduct(''); setQuantity('1'); setUnitCost('');
  };
  const addSupplier = (event: React.FormEvent) => {
    event.preventDefault();
    if (!supplierName.trim()) return;
    const supplier = { id: `draft-${Date.now()}`, name: supplierName.trim(), reference: supplierReference.trim() };
    setSuppliers(previous => [...previous, supplier]); setSelectedSupplier(supplier.id); setSupplierName(''); setSupplierReference('');
  };

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="SUPPLY & PURCHASING" title="Purchasing" description="Prepare orders and check deliveries against the items you buy." action={<span className="local-data-badge"><span /> Draft preview</span>} />
    <div className="preview-notice"><PackageCheck size={16} /><span>Supplier records and orders are temporary drafts in this screen. Delivery review does not change stock or accounts.</span></div>
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
      <div className="form-grid"><label className="form-field"><span>Supplier</span><select value={selectedSupplier} onChange={event => setSelectedSupplier(event.target.value)}><option value="">Choose a draft supplier</option>{suppliers.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label><label className="form-field"><span>Delivery reference</span><input value={reference} onChange={event => setReference(event.target.value)} placeholder="Invoice or delivery note" /></label></div>
      <div className="line-entry-grid"><label className="form-field"><span>Received item</span><select value={selectedProduct} onChange={event => setSelectedProduct(event.target.value)}><option value="">Choose item</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="form-field"><span>Quantity received</span><input inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} placeholder="Optional" /></label><button type="button" className="secondary-action" onClick={addLine}><Plus size={15} /> Add line</button></div>
      <DraftLines lines={lines} onRemove={index => setLines(previous => previous.filter((_, i) => i !== index))} />
      <div className="review-summary"><span>{lines.length} lines · {totalUnits} units reviewed</span><button type="button" className="primary-action" disabled={!lines.length || !selectedSupplier} onClick={() => setReviewOpen(true)}>Review delivery <span>Not posted</span></button></div>
    </section>}
    {tab === 'suppliers' && <div className="procurement-layout"><section className="workflow-panel"><div className="panel-heading"><div><h2>Add supplier to this preview</h2><p>Supplier details remain in memory until you leave.</p></div></div><form onSubmit={addSupplier} className="form-grid"><label className="form-field"><span>Supplier name</span><input required value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Business or contact name" /></label><label className="form-field"><span>Account reference</span><input value={supplierReference} onChange={event => setSupplierReference(event.target.value)} placeholder="Optional" /></label><button type="submit" className="secondary-action"><Plus size={15} /> Add draft supplier</button></form></section><section className="workflow-panel"><div className="panel-heading"><div><h2>Suppliers</h2><p>{suppliers.length} draft records in this session</p></div></div>{suppliers.length ? <div className="simple-record-list">{suppliers.map(supplier => <div key={supplier.id}><strong>{supplier.name}</strong><small>{supplier.reference || 'No reference'}</small><span>Draft only</span></div>)}</div> : <EmptyState title="No supplier drafts" detail="Add a supplier on the left to include it in an order preview." />}</section></div>}
    {tab === 'payables' && <section className="workflow-panel"><div className="panel-heading"><div><h2>Supplier balances</h2><p>Invoices and payments need an accounts payable service.</p></div></div><EmptyState title="No payable records available" detail="This preview does not have supplier invoice or settlement records. Delivery notes alone do not mean a supplier has been paid." /></section>}
    {reviewOpen && <div className="review-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReviewOpen(false); }}><section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="purchase-review-title"><div className="panel-heading"><div><span className="eyebrow">LOCAL PREVIEW</span><h2 id="purchase-review-title">Review {tab === 'receive' ? 'delivery' : 'purchase order'}</h2></div><button type="button" className="quiet-action" onClick={() => setReviewOpen(false)}>Close</button></div><p className="muted-copy">{selectedSupplier ? suppliers.find(item => item.id === selectedSupplier)?.name : 'No supplier selected'} · {reference || 'No reference'}</p><DraftLines lines={lines} onRemove={index => setLines(previous => previous.filter((_, i) => i !== index))} /><div className="preview-notice"><CircleAlert size={16} /><span>Not sent or posted. Stock, supplier balances, and the ledger have not changed.</span></div><button type="button" className="primary-action" onClick={() => setReviewOpen(false)}>Return to draft</button></section></div>}
  </div>;
}

function DraftLines({ lines, onRemove }: { lines: DeliveryLine[]; onRemove: (index: number) => void }) {
  if (!lines.length) return <EmptyState title="No items added" detail="Choose products and quantities to create a review draft." />;
  return <div className="draft-lines">{lines.map((line, index) => <div key={`${line.product.id}-${index}`}><span><strong>{line.product.name}</strong><small>{line.quantity} {line.product.unit}{line.unitCost ? ` · Cost ${line.unitCost} / unit` : ''}</small></span><button type="button" onClick={() => onRemove(index)}>Remove</button></div>)}</div>;
}
