import React from 'react';
import { ArrowUpRight, CircleHelp, CreditCard, PackageSearch, ShoppingCart } from 'lucide-react';
import type { WorkspaceId } from '../../types/ui';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { apiClient } from '../../services/apiClient';

export function HelpWorkspace({ onNavigate }: { onNavigate: (workspace: WorkspaceId) => void }) {
  const session = apiClient.getSession();
  if (!session) return null;
  return <div className="page-stack">
    <WorkspaceHeading eyebrow="SERVER HELP AND RECOVERY" title="Work safely with server records" description="Use the signed-in operator and outlet shown in the workspace header. Server commands remain online-only." />
    <div className="help-grid">
      {session.user.permissions.includes('commerce.sell') && session.tenant.capabilities.includes('commerce') && <button type="button" onClick={() => onNavigate('sell')}><ShoppingCart /><span><strong>Make a sale</strong><small>Use the server catalogue and the current authorized till.</small></span><ArrowUpRight /></button>}
      {session.tenant.capabilities.includes('inventory') && session.user.permissions.some(p=>['catalog.manage','inventory.receive'].includes(p)) && <button type="button" onClick={() => onNavigate('stock')}><PackageSearch /><span><strong>Review stock</strong><small>See the current server catalogue, balances and movements.</small></span><ArrowUpRight /></button>}
      {session.tenant.capabilities.includes('commerce') && session.user.permissions.some(p=>['shift.open','shift.close'].includes(p)) && <button type="button" onClick={() => onNavigate('shifts')}><CreditCard /><span><strong>Cash-up</strong><small>Review expected cash and record the physical count at close.</small></span><ArrowUpRight /></button>}
    </div>
    <section className="help-recovery"><div className="help-recovery-icon"><CircleHelp /></div><div><h2>Not sure whether a command completed?</h2><p>Use the server command recovery notice at the top of the page. Check the stored command status before repeating a sale, receipt or cash movement.</p></div></section>
    <div className="integration-boundary"><CircleHelp size={17} /><span>Use Manage for business details, tax policy, outlet information and receipt settings. Only an administrator can change these settings.</span></div>
  </div>;
}
