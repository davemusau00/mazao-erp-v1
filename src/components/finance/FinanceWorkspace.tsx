import React, { useState } from 'react';
import { BookOpenCheck, CalendarClock, CircleAlert, FileUp, WalletCards } from 'lucide-react';
import type { TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { LedgerView } from './LedgerView';
import { EmptyState, WorkspaceHeading } from '../common/WorkspacePrimitives';
import { MoneyInput } from '../common/FormControls';
import { formatMinorMoney } from '../../utils/money';

type FinanceTab = 'ledger' | 'reconciliation' | 'expenses' | 'periods';
interface ExpenseDraft { label: string; amountMinor: number; category: string; }

export function FinanceWorkspace({ tenant }: { tenant: TenantProfile }) {
  const [tab, setTab] = useState<FinanceTab>('ledger');
  const [statementFile, setStatementFile] = useState('');
  const [expenseLabel, setExpenseLabel] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Operating costs');
  const [expenseAmount, setExpenseAmount] = useState<number | null>(null);
  const [expenseDrafts, setExpenseDrafts] = useState<ExpenseDraft[]>([]);
  const entries = storage.getLedgerEntries();
  const tabs: Array<[FinanceTab, string]> = [['ledger', 'Ledger'], ['reconciliation', 'Reconciliation'], ['expenses', 'Expenses'], ['periods', 'Periods & close']];
  const addExpenseDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!expenseLabel.trim() || expenseAmount === null || expenseAmount <= 0) return;
    setExpenseDrafts(previous => [...previous, { label: expenseLabel.trim(), category: expenseCategory, amountMinor: expenseAmount }]);
    setExpenseLabel(''); setExpenseAmount(null);
  };

  return <div className="page-stack finance-workspace">
    <WorkspaceHeading eyebrow="MONEY" title="Finance & accounts" description="Review money movement and prepare a reconciliation or period-close checklist." action={<span className="local-data-badge"><span /> Local preview</span>} />
    <div className="preview-notice"><CircleAlert size={16} /><span>Amounts and ledger entries shown here come from browser demo storage. They are not a reconciled accounting record or a completed financial statement.</span></div>
    <div className="workspace-tabs" role="tablist" aria-label="Finance sections">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'ledger' && <div className="finance-ledger-frame"><LedgerView tenant={tenant} /></div>}
    {tab === 'reconciliation' && <div className="finance-two-column"><section className="workflow-panel"><div className="panel-heading"><div><h2>Statement reconciliation</h2><p>Review external statement lines against recorded payments.</p></div><WalletCards size={18} /></div><label className="file-drop-area statement-upload"><FileUp size={22} /><strong>Select a bank or payment statement</strong><span>Choose a file to preview its name. No file is uploaded or parsed in this local build.</span><span className="secondary-action">Choose statement<input type="file" accept=".csv,.xlsx,.pdf" onChange={event => setStatementFile(event.target.files?.[0]?.name ?? '')} /></span>{statementFile && <small className="selected-file">Selected: {statementFile} · not uploaded</small>}</label></section><section className="workflow-panel"><div className="panel-heading"><div><h2>Unmatched transactions</h2><p>Match only after dates and amounts have been reviewed.</p></div></div><EmptyState title="No reconciliation session" detail="Statement upload, matching rules, and variance posting need an accounting service. No bank or M-Pesa line has been reconciled." /></section></div>}
    {tab === 'expenses' && <div className="finance-two-column"><section className="workflow-panel"><div className="panel-heading"><div><h2>Expense draft</h2><p>Describe the expense and review the amount.</p></div></div><form className="form-grid" onSubmit={addExpenseDraft}><label className="form-field"><span>Description</span><input value={expenseLabel} onChange={event => setExpenseLabel(event.target.value)} placeholder="What was purchased?" /></label><label className="form-field"><span>Category</span><select value={expenseCategory} onChange={event => setExpenseCategory(event.target.value)}><option>Operating costs</option><option>Utilities</option><option>Transport</option><option>Repairs and maintenance</option><option>Other</option></select></label><MoneyInput label="Amount" currency={tenant.currency} valueMinor={expenseAmount} onChange={setExpenseAmount} /><button className="secondary-action" type="submit">Add expense draft</button></form><div className="preview-notice"><CircleAlert size={15} /><span>Drafts are held only in this screen. No cash movement or journal entry is created.</span></div></section><section className="workflow-panel"><div className="panel-heading"><div><h2>Expense drafts</h2><p>{expenseDrafts.length} draft lines · not posted</p></div></div>{expenseDrafts.length ? <div className="simple-record-list">{expenseDrafts.map((draft, index) => <div key={`${draft.label}-${index}`}><strong>{draft.label}</strong><small>{draft.category}</small><span>{formatMinorMoney(draft.amountMinor, tenant.currency)}</span></div>)}</div> : <EmptyState title="No expense drafts" detail="Add a line on the left to review how an expense entry looks." />}</section></div>}
    {tab === 'periods' && <section className="workflow-panel"><div className="panel-heading"><div><h2>Period close</h2><p>Prepare a close checklist before restricting a reporting period.</p></div><CalendarClock size={18} /></div><div className="period-status-card"><BookOpenCheck size={20} /><span><strong>Period status unavailable</strong><small>This preview has no period-control service, so it cannot confirm whether a period is open or closed.</small></span></div><ul className="check-list"><li>Review till and payment reconciliation.</li><li>Confirm receivables and supplier balances.</li><li>Check trial balance and unresolved source entries.</li><li>Review late and backdated transactions.</li><li>Close only with authorized approval and an audit reference.</li></ul><div className="preview-notice"><CircleAlert size={15} /><span>No period was closed and no posting restrictions were changed.</span></div></section>}
    <div className="finance-source-footnote">{entries.length} local ledger lines · source freshness and report coverage are not verified.</div>
  </div>;
}
