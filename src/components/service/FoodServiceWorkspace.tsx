import React, { useMemo, useState } from 'react';
import { ChefHat, CircleAlert, Clock3, Plus, Send, Soup, Utensils } from 'lucide-react';
import type { ProductItem } from '../../types/erp';
import { storage } from '../../services/storage';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';

type BoardTab = 'floor' | 'kitchen';
interface DraftLine { product: ProductItem; quantity: number; notes: string; }
interface DraftTicket { id: string; table: string; lines: DraftLine[]; createdAt: string; state: 'draft' | 'preview'; }

export function FoodServiceWorkspace() {
  const [tab, setTab] = useState<BoardTab>('floor');
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [tableName, setTableName] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tickets, setTickets] = useState<DraftTicket[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState('');
  const products = storage.getProducts();
  const filteredProducts = useMemo(() => products.filter(product => product.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6), [products, query]);
  const currentTicket = tickets.find(ticket => ticket.table === selectedTable);

  const addTable = (event: React.FormEvent) => {
    event.preventDefault();
    const name = tableName.trim();
    if (!name || tableNames.includes(name)) return;
    setTableNames(previous => [...previous, name]); setTableName(''); setSelectedTable(name);
  };
  const addProduct = (product: ProductItem) => setLines(previous => {
    const existing = previous.find(line => line.product.id === product.id);
    return existing ? previous.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...previous, { product, quantity: 1, notes: '' }];
  });
  const saveDraftPreview = () => {
    if (!selectedTable || !lines.length) return;
    setTickets(previous => {
      const existing = previous.find(ticket => ticket.table === selectedTable);
      const ticket: DraftTicket = { id: existing?.id ?? `preview-${Date.now()}`, table: selectedTable, lines: [...lines], createdAt: existing?.createdAt ?? new Date().toISOString(), state: 'draft' };
      return existing ? previous.map(row => row.table === selectedTable ? ticket : row) : [...previous, ticket];
    });
    setLines([]);
  };
  const firePreview = (ticket: DraftTicket) => setTickets(previous => previous.map(row => row.id === ticket.id ? { ...row, state: 'preview' } : row));

  return <div className="page-stack">
    <WorkspaceHeading eyebrow="FOOD SERVICE" title="Tables & kitchen" description="Manage a floor order and follow its preparation through a clear station view." action={<span className="local-data-badge"><span /> Interaction preview</span>} />
    <div className="preview-notice"><CircleAlert size={16} /><span>This preview keeps table orders in memory only. Sending a ticket here does not reach a kitchen printer or post a sale.</span></div>
    <div className="workspace-tabs" role="tablist" aria-label="Food service view">
      <button type="button" role="tab" aria-selected={tab === 'floor'} className={tab === 'floor' ? 'active' : ''} onClick={() => setTab('floor')}><Utensils size={15} /> Floor</button>
      <button type="button" role="tab" aria-selected={tab === 'kitchen'} className={tab === 'kitchen' ? 'active' : ''} onClick={() => setTab('kitchen')}><ChefHat size={15} /> Kitchen <span className="tab-count">{tickets.filter(ticket => ticket.state === 'preview').length}</span></button>
    </div>
    {tab === 'floor' ? <div className="food-floor-layout">
      <section className="workflow-panel"><div className="panel-heading"><div><h2>Floor tables</h2><p>Table layout preview · not saved</p></div></div>
        {!tableNames.length ? <EmptyState title="No tables in this preview" detail="Add temporary table labels to explore the floor and order workflow." /> : <div className="table-card-grid">{tableNames.map(name => { const ticket = tickets.find(row => row.table === name); return <button key={name} type="button" className={`table-card ${selectedTable === name ? 'selected' : ''}`} onClick={() => { setSelectedTable(name); setLines(ticket?.lines ?? []); }}><span className="table-card-icon"><Utensils size={19} /></span><strong>{name}</strong><small>{ticket ? `${ticket.lines.reduce((sum, line) => sum + line.quantity, 0)} items · ${ticket.state === 'preview' ? 'Ticket previewed' : 'Draft'}` : 'Available'}</small></button>; })}</div>}
        <form className="inline-create-form" onSubmit={addTable}><label className="sr-only" htmlFor="preview-table-name">Table label</label><input id="preview-table-name" value={tableName} onChange={event => setTableName(event.target.value)} placeholder="Table name or number" /><button type="submit"><Plus size={15} /> Add preview table</button></form>
      </section>
      <section className="workflow-panel order-builder"><div className="panel-heading"><div><h2>{selectedTable ? `Order · ${selectedTable}` : 'Start an order'}</h2><p>Choose a table, then add items from the menu.</p></div></div>
        {selectedTable ? <><label className="sr-only" htmlFor="menu-search">Search menu items</label><input className="workflow-search" id="menu-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search menu items" />
          <div className="menu-pick-list">{filteredProducts.map(product => <button type="button" key={product.id} onClick={() => addProduct(product)}><span>{product.name}<small>{product.category} · {product.unit}</small></span><span>{product.sku}<Plus size={14} /></span></button>)}</div>
          <div className="draft-order-lines">{lines.length ? lines.map(line => <div key={line.product.id}><span>{line.quantity} × {line.product.name}</span><button type="button" onClick={() => setLines(previous => previous.filter(item => item.product.id !== line.product.id))}>Remove</button></div>) : <p className="muted-copy">No items added yet.</p>}</div>
          <button type="button" className="primary-action" disabled={!lines.length} onClick={saveDraftPreview}>Save order draft <span>Preview only</span></button>
        </> : <EmptyState title="Choose a table" detail="Select a table card or add a preview table to begin." />}
      </section>
    </div> : <section className="workflow-panel"><div className="panel-heading"><div><h2>Kitchen tickets</h2><p>Only preview tickets created in this browser session appear here.</p></div><span className="subtle-count"><Clock3 size={14} /> {tickets.length} drafts</span></div>
      {tickets.filter(ticket => ticket.lines.length).length ? <div className="ticket-grid">{tickets.filter(ticket => ticket.lines.length).map(ticket => <article className="ticket-card" key={ticket.id}><div className="ticket-card-head"><div><span className="ticket-status"><Soup size={13} /> {ticket.state === 'preview' ? 'PREVIEW ONLY' : 'DRAFT'}</span><h3>{ticket.table}</h3></div><small>{new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div><ul>{ticket.lines.map(line => <li key={line.product.id}><span>{line.quantity} ×</span>{line.product.name}{line.notes && <small>{line.notes}</small>}</li>)}</ul><button type="button" disabled={ticket.state === 'preview'} onClick={() => firePreview(ticket)}><Send size={14} /> {ticket.state === 'preview' ? 'Not sent to kitchen' : 'Preview ticket handoff'}</button></article>)}</div> : <EmptyState title="Kitchen is clear" detail="Save an order draft from the Floor tab to review a kitchen ticket." />}
    </section>}
  </div>;
}
