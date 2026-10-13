import React from 'react';
import { Building2, CircleAlert, ContactRound, FileUp, MonitorCog, ReceiptText, Settings2 } from 'lucide-react';
import { TenantProfile } from '../../types/erp';
import { storage } from '../../services/storage';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';

const cards = [
  { icon: <Building2 />, title: 'Business and outlets', detail: 'Business profile, outlet identity, currency and time zone.' },
  { icon: <ContactRound />, title: 'Staff and access', detail: 'Staff membership, assigned roles, and permission review.' },
  { icon: <ReceiptText />, title: 'Payments and receipts', detail: 'Receipt details, payment methods, and printer profile.' },
  { icon: <MonitorCog />, title: 'Devices', detail: 'Enrolled terminals, device status, and access revocation.' },
  { icon: <FileUp />, title: 'Bring in your data', detail: 'Map product columns, review errors, and preview the import.' },
  { icon: <Settings2 />, title: 'Business capabilities', detail: 'Turn on the workflows your outlets use.' },
];

export function ManageWorkspace({ tenant }: { tenant: TenantProfile }) {
  const staff = storage.getStaffUsers();
  return <div className="page-stack">
    <WorkspaceHeading eyebrow="BUSINESS SETUP" title="Manage your workspace" description="Business details and day-to-day setup for this local demo." />
    <div className="settings-profile-card"><div className="settings-profile-icon"><Building2 /></div><div><span className="eyebrow">ACTIVE BUSINESS</span><h2>{tenant.name}</h2><p>{tenant.type.replace('_', ' ')} · {tenant.currency} · Africa/Nairobi</p></div><span className="local-data-badge"><span /> On this device</span></div>
    <div className="manage-grid">{cards.map(card => <article className="manage-card" key={card.title}><div className="manage-card-icon">{card.icon}</div><div><h2>{card.title}</h2><p>{card.detail}</p></div><span className="not-connected">Admin service not connected</span></article>)}</div>
    <section className="workspace-section"><div className="section-heading"><div><h2>Demo operators</h2><p>Operator profiles available in this browser preview.</p></div></div><div className="operator-summary-list">{staff.map(person => <div key={person.id}><span className="operator-avatar">{person.name.slice(0, 1)}</span><span><strong>{person.name}</strong><small>{person.title}</small></span><span className="role-tag">{person.role}</span></div>)}</div></section>
    <div className="integration-boundary"><CircleAlert size={17} /><span><strong>Configuration changes are not enabled here.</strong> This prototype has no authenticated administration service. These sections will not save or change business access.</span></div>
  </div>;
}
