import React from 'react';
import { ArrowUpRight, CircleHelp, CreditCard, PackageSearch, ShoppingCart } from 'lucide-react';
import type { WorkspaceId } from '../../types/ui';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { apiClient } from '../../services/apiClient';

export function HelpWorkspace({ onNavigate }: { onNavigate: (workspace: WorkspaceId) => void }) {
  const session = apiClient.getSession();
  if (!session) return null;
  return <div className="page-stack">
    <WorkspaceHeading eyebrow="HELP AND SUPPORT" title="Help with your daily work" description="Check your name and outlet at the top of the page. A connection is required to complete business actions." />
    <div className="help-grid">
      {session.user.permissions.includes('commerce.sell') && session.tenant.capabilities.includes('commerce') && <button type="button" onClick={() => onNavigate('sell')}><ShoppingCart /><span><strong>Make a sale</strong><small>Choose items and take payment using your open till.</small></span><ArrowUpRight /></button>}
      {session.tenant.capabilities.includes('inventory') && session.user.permissions.some(p=>['catalog.manage','inventory.receive'].includes(p)) && <button type="button" onClick={() => onNavigate('stock')}><PackageSearch /><span><strong>Review stock</strong><small>Review items, balances and stock movements.</small></span><ArrowUpRight /></button>}
      {session.tenant.capabilities.includes('commerce') && session.user.permissions.some(p=>['shift.open','shift.close'].includes(p)) && <button type="button" onClick={() => onNavigate('shifts')}><CreditCard /><span><strong>Cash-up</strong><small>Review expected cash and record the physical count at close.</small></span><ArrowUpRight /></button>}
    </div>
    <section className="help-recovery"><div className="help-recovery-icon"><CircleHelp /></div><div><h2>Not sure whether an action completed?</h2><p>Open Actions needing review at the top of the page. Check status before repeating a payment, stock delivery or cash movement.</p></div></section>
    <div className="integration-boundary"><CircleHelp size={17} /><span>Use Manage for business details, tax policy, outlet information and receipt settings. Only an administrator can change these settings.</span></div>
  </div>;
}
