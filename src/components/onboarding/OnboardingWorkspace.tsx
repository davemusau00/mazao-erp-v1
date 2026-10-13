import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CircleAlert, FileSpreadsheet, Store, Users } from 'lucide-react';
import type { TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';

const steps = [
  { id: 'business', title: 'Business', detail: 'Name and business type' },
  { id: 'capabilities', title: 'Capabilities', detail: 'Choose the work you do' },
  { id: 'outlet', title: 'Outlet', detail: 'Location and business day' },
  { id: 'payments', title: 'Payments', detail: 'Tax policy and tenders' },
  { id: 'team', title: 'Team & devices', detail: 'People and workstations' },
  { id: 'catalog', title: 'Items & opening stock', detail: 'Add items or review an import' },
  { id: 'first-shift', title: 'First shift', detail: 'Check the sale and till setup' },
  { id: 'readiness', title: 'Go-live review', detail: 'See what is ready and missing' },
] as const;

export function OnboardingWorkspace({ tenant }: { tenant: TenantProfile }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [businessName, setBusinessName] = useState(tenant.name);
  const [businessType, setBusinessType] = useState(tenant.type);
  const [outletName, setOutletName] = useState(tenant.outletName ?? 'Main outlet');
  const [timeZone, setTimeZone] = useState(tenant.timeZone ?? 'Africa/Nairobi');
  const [selectedFile, setSelectedFile] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const step = steps[stepIndex];
  const staff = storage.getStaffUsers();
  const products = storage.getProducts();
  const readiness = useMemo(() => [
    { label: 'Business name entered', ready: Boolean(businessName.trim()) },
    { label: 'Outlet name and time zone set', ready: Boolean(outletName.trim() && timeZone) },
    { label: 'Items ready to sell', ready: products.length > 0 },
    { label: 'Team profiles available', ready: staff.length > 0 },
    { label: 'Printer profile checked', ready: false, note: 'Needs device acceptance' },
    { label: 'First sale and opening shift checked', ready: false, note: 'Not verified in this preview' },
  ], [businessName, outletName, timeZone, products.length, staff.length]);

  return <div className="page-stack onboarding-page">
    <WorkspaceHeading eyebrow="FIRST USE" title="Set up your business" description="A guided checklist for preparing one outlet. You can review each step without completing every optional setup item." action={<span className="local-data-badge"><span /> Draft only · not saved</span>} />
    <div className="preview-notice"><CircleAlert size={16} /><span>This setup stays in the current browser session. It will not create a business, configure tax, import items, or mark the outlet live.</span></div>
    <div className="onboarding-layout">
      <nav className="onboarding-steps" aria-label="Setup steps">{steps.map((item, index) => <button key={item.id} type="button" className={`${stepIndex === index ? 'active' : ''} ${index < stepIndex ? 'visited' : ''}`} onClick={() => setStepIndex(index)} aria-current={stepIndex === index ? 'step' : undefined}><span className="step-number">{index < stepIndex ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</nav>
      <section className="workflow-panel onboarding-step-panel"><div className="panel-heading"><div><span className="eyebrow">STEP {String(stepIndex + 1).padStart(2, '0')} OF {steps.length}</span><h2>{step.title}</h2><p>{step.detail}</p></div></div>
        {step.id === 'business' && <div className="form-grid"><label className="form-field"><span>Business name</span><input value={businessName} onChange={event => setBusinessName(event.target.value)} placeholder="Registered or trading name" /></label><label className="form-field"><span>Business type</span><select value={businessType} onChange={event => setBusinessType(event.target.value as TenantProfile['type'])}><option value="retail">Retail</option><option value="restaurant">Restaurant or cafe</option><option value="hospitality">Hotel or guest house</option><option value="farm_estate">Farm or estate</option></select></label><div className="setup-guidance"><Building2 size={17} /><span>Use the name customers recognize. Legal and tax identity can be completed by an authorized administrator.</span></div></div>}
        {step.id === 'capabilities' && <div className="capability-check-grid">{[['retail','Retail counter','Sell items and manage stock'],['food_service','Food service','Tables, tabs, and kitchen tickets'],['hospitality','Hotel and rooms','Reservations and guest bills'],['procurement','Purchasing','Suppliers and delivery receiving'],['accounting','Finance','Ledger, expenses, and reports']].map(([id,label,detail]) => <label key={id} className="capability-option"><input type="checkbox" defaultChecked={id === 'retail' || (id === 'hospitality' && businessType === 'hospitality') || (id === 'food_service' && businessType === 'restaurant')} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div>}
        {step.id === 'outlet' && <div className="form-grid"><label className="form-field"><span>Outlet name</span><input value={outletName} onChange={event => setOutletName(event.target.value)} /></label><label className="form-field"><span>Business time zone</span><select value={timeZone} onChange={event => setTimeZone(event.target.value)}><option value="Africa/Nairobi">East Africa Time · Africa/Nairobi</option><option value="Africa/Kampala">East Africa Time · Africa/Kampala</option><option value="Africa/Dar_es_Salaam">East Africa Time · Africa/Dar_es_Salaam</option><option value="UTC">Coordinated Universal Time · UTC</option></select></label><div className="setup-guidance"><Store size={17} /><span>Business-day reports use the outlet time zone, including shift boundaries and date filters.</span></div></div>}
        {step.id === 'payments' && <div className="setup-section-stack"><div className="form-grid"><label className="form-field"><span>Currency</span><select defaultValue={tenant.currency}><option>KES</option><option>UGX</option><option>TZS</option><option>USD</option></select></label><label className="form-field"><span>Tax policy</span><select defaultValue="unconfigured"><option value="unconfigured">Not configured · needs review</option><option value="configured">Configured by administrator</option></select></label></div><div className="capability-check-grid two-col">{[['Cash','Record cash received'],['Manual M-Pesa','Record customer-confirmed reference'],['Card','Use an accepted card terminal'],['Guest bill','Charge an active guest stay']].map(([label,detail]) => <label key={label} className="capability-option"><input type="checkbox" defaultChecked={label === 'Cash' || label === 'Manual M-Pesa'} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div><div className="preview-notice"><CircleAlert size={16} /><span>Tax rates and invoice requirements must be configured for this business. This preview does not infer a tax rate.</span></div></div>}
        {step.id === 'team' && <div className="setup-section-stack"><div className="settings-profile-card"><div className="settings-profile-icon"><Users /></div><div><span className="eyebrow">LOCAL PREVIEW PROFILES</span><h2>{staff.length} operator profiles</h2><p>Profiles shown here are browser demo data, not enrolled employees.</p></div></div><div className="check-list-card"><strong>Before inviting staff</strong><p>Assign each person an individual account, grant only the permissions they need, and enroll the terminal they will use.</p><strong>Device enrollment</strong><p>No authenticated device enrollment service is connected to this preview.</p></div></div>}
        {step.id === 'catalog' && <div className="setup-section-stack"><div className="file-drop-area"><FileSpreadsheet size={24} /><strong>Choose an item CSV or spreadsheet</strong><span>CSV and XLSX import needs an authenticated preview service before any rows can be applied.</span><label className="secondary-action">Choose file<input type="file" accept=".csv,.xlsx,.xls" onChange={event => setSelectedFile(event.target.files?.[0]?.name ?? '')} /></label>{selectedFile && <small className="selected-file">Selected: {selectedFile} · not uploaded</small>}</div><div className="setup-guidance"><CircleAlert size={17} /><span>Opening quantities are recorded as stock movements. Re-importing must never silently replace a stock balance.</span></div></div>}
        {step.id === 'first-shift' && <div className="setup-section-stack"><div className="first-sale-preview"><div><span className="eyebrow">SAFE GO-LIVE CHECK</span><h3>Test the whole operator path</h3><p>Confirm a role can open a shift, add an item, record the correct tender, view the receipt, and close with a counted cash amount.</p></div><span className="not-connected">Not verified in this preview</span></div><ul className="check-list"><li>Confirm item prices and tax classifications</li><li>Confirm receipt profile and manual print fallback</li><li>Confirm staff permissions and outlet assignment</li><li>Rehearse cash-up and discrepancy review</li></ul></div>}
        {step.id === 'readiness' && <div className="setup-section-stack"><div className="readiness-count"><strong>{readiness.filter(item => item.ready).length} of {readiness.length}</strong><span>readiness checks available from this local preview</span></div><div className="readiness-list">{readiness.map(item => <div key={item.label} className={item.ready ? 'ready' : 'pending'}><span>{item.ready ? <Check size={15} /> : <CircleAlert size={15} />}</span><strong>{item.label}</strong><small>{item.ready ? 'Present in preview data' : item.note ?? 'Needs setup or live service verification'}</small></div>)}</div><button type="button" className="secondary-action" onClick={() => setReviewed(true)}>Review readiness</button>{reviewed && <div className="preview-notice"><CircleAlert size={16} /><span>Checklist reviewed for this session. This does not provision the outlet or authorize go-live.</span></div>}</div>}
        <div className="wizard-footer"><button type="button" className="quiet-action" onClick={() => setStepIndex(value => Math.max(0, value - 1))} disabled={stepIndex === 0}><ArrowLeft size={15} /> Back</button><span>{stepIndex + 1} / {steps.length}</span><button type="button" className="secondary-action" onClick={() => setStepIndex(value => Math.min(steps.length - 1, value + 1))} disabled={stepIndex === steps.length - 1}>Next step <ArrowRight size={15} /></button></div>
      </section>
    </div>
  </div>;
}
