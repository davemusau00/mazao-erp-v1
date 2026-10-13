import React from 'react';
import { ArrowRight, Search } from 'lucide-react';

export function WorkspaceHeading({ eyebrow, title, description, action }: {
  eyebrow?: string; title: string; description?: string; action?: React.ReactNode;
}) {
  return <div className="workspace-heading">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="workspace-heading-action">{action}</div>}
  </div>;
}

export function SummaryMetric({ label, value, detail, tone = 'default' }: {
  label: string; value: React.ReactNode; detail?: string; tone?: 'default' | 'positive' | 'warning';
}) {
  return <article className={`summary-metric metric-${tone}`}>
    <span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}
  </article>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-mark"><Search size={19} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function NextStepCard({ title, detail, onClick, label = 'Open' }: {
  title: string; detail: string; onClick?: () => void; label?: string;
}) {
  return <button type="button" className="next-step-card" onClick={onClick} disabled={!onClick}>
    <span><strong>{title}</strong><small>{detail}</small></span><span className="next-step-action">{label}<ArrowRight size={15} /></span>
  </button>;
}
