import React, { useMemo, useState } from 'react';
import { Barcode, CircleAlert, ClipboardCheck, PackageSearch, Search } from 'lucide-react';
import type { ProductItem } from '../../types/erp';
import { storage } from '../../services/storage';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';
import { decimalStringsEqual, subtractDecimalStrings } from '../../utils/decimal';

interface CountLine { product: ProductItem; counted: string; reason: string; }

export function StockCountWorkspace() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [lines, setLines] = useState<CountLine[]>([]);
  const [review, setReview] = useState(false);
  const products = storage.getProducts();
  const matches = useMemo(() => query.trim() ? products.filter(product => `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7) : [], [products, query]);
  const addItem = (product: ProductItem) => {
    setLines(previous => previous.some(line => line.product.id === product.id) ? previous : [...previous, { product, counted: '', reason: '' }]);
    setQuery('');
  };
  const updateLine = (id: string, key: 'counted' | 'reason', value: string) => setLines(previous => previous.map(line => line.product.id === id ? { ...line, [key]: value } : line));
  const completeLines = lines.filter(line => line.counted.trim() !== '' && Number.isFinite(Number(line.counted)) && Number(line.counted) >= 0);
  const varianceCount = completeLines.filter(line => !decimalStringsEqual(line.counted, String(line.product.stockOnHand))).length;

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="STOCK · PHYSICAL COUNT" title="Count stock" description="Record what is physically present, review differences, and keep the count draft intact." action={<span className="local-data-badge"><span /> Unsaved count draft</span>} />
    <div className="preview-notice"><CircleAlert size={16} /><span>This count remains in this page until you leave. Reviewing it does not adjust stock; posting requires an authorized, atomic count service.</span></div>
    <section className="workflow-panel"><div className="count-session-header"><div><span className="eyebrow">COUNT SESSION</span><h2>Choose a location and scan items</h2><p>Baseline shown from the local preview data.</p></div><label className="form-field"><span>Location name</span><input value={location} onChange={event => setLocation(event.target.value)} placeholder="Enter location" /></label></div>
      <div className="count-search-wrap"><Barcode size={17} /><input autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches.length === 1) { event.preventDefault(); addItem(matches[0]); } }} placeholder="Scan barcode or search by item name / SKU" /><Search size={16} /></div>
      {matches.length > 0 && <div className="count-suggestions">{matches.map(product => <button type="button" key={product.id} onClick={() => addItem(product)}><span><strong>{product.name}</strong><small>{product.sku} · {product.barcode}</small></span><span>{product.stockOnHand} {product.unit} expected</span></button>)}</div>}
      <div className="count-session-summary"><span><PackageSearch size={15} /> {lines.length} items in this draft</span><span>{completeLines.length} counted · {varianceCount} differences</span></div>
      {lines.length ? <div className="count-lines">{lines.map(line => { const variance = line.counted !== '' ? subtractDecimalStrings(line.counted, String(line.product.stockOnHand)) : null; return <article key={line.product.id}><div className="count-product"><strong>{line.product.name}</strong><small>{line.product.sku} · expected {line.product.stockOnHand} {line.product.unit}</small></div><label className="form-field"><span>Counted</span><input type="text" inputMode="decimal" value={line.counted} onChange={event => updateLine(line.product.id, 'counted', event.target.value.replace(/[^\d.]/g, ''))} placeholder="Enter quantity" /></label><span className={`count-variance ${variance == null ? '' : variance === '0' ? 'balanced' : 'changed'}`}>{variance == null ? 'Not counted' : variance === '0' ? 'Matches' : `${variance.startsWith('-') ? '' : '+'}${variance} ${line.product.unit}`}</span><label className="form-field reason-field"><span>Reason if different</span><input value={line.reason} onChange={event => updateLine(line.product.id, 'reason', event.target.value)} placeholder="Required for a variance" /></label><button className="quiet-action remove-count-line" type="button" onClick={() => setLines(previous => previous.filter(row => row.product.id !== line.product.id))}>Remove</button></article>; })}</div> : <EmptyState title="No items counted yet" detail="Use a barcode scanner or search the item list to start the session." />}
      <div className="count-footer"><span>Count draft is held in this page only.</span><button className="primary-action" type="button" disabled={!location.trim() || !completeLines.length || completeLines.some(line => Number(line.counted) !== line.product.stockOnHand && !line.reason.trim())} onClick={() => setReview(true)}><ClipboardCheck size={15} /> Review differences</button></div>
    </section>
    {review && <div className="review-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReview(false); }}><section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="count-review-title"><div className="panel-heading"><div><span className="eyebrow">COUNT REVIEW · {location}</span><h2 id="count-review-title">Check the differences</h2></div><button type="button" className="quiet-action" onClick={() => setReview(false)}>Close</button></div><div className="count-review-list">{completeLines.map(line => { const variance = subtractDecimalStrings(line.counted, String(line.product.stockOnHand)); return <div key={line.product.id}><span><strong>{line.product.name}</strong><small>Expected {line.product.stockOnHand} · counted {line.counted} {line.product.unit}</small></span><span className={variance === '0' ? 'balanced' : 'changed'}>{variance.startsWith('-') ? '' : '+'}{variance}</span><small>{line.reason || 'No variance'}</small></div>; })}</div><div className="preview-notice"><CircleAlert size={16} /><span>Review complete. No stock movement was created. A real posting must check the baseline revision and apply all variances atomically.</span></div><button className="primary-action" type="button" onClick={() => setReview(false)}>Return to count</button></section></div>}
  </div>;
}
