import React from 'react';
import { ArrowUpRight, CircleHelp, CreditCard, PackageSearch, ShoppingCart, WifiOff } from 'lucide-react';
import type { WorkspaceId } from '../../types/ui';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';
import { apiClient } from '../../services/apiClient';

export function HelpWorkspace({ onNavigate, onOpenSyncCenter }: { onNavigate: (workspace: WorkspaceId) => void; onOpenSyncCenter: () => void }) {
  const session = apiClient.getSession();
  if (session) return <div className="page-stack">
    <WorkspaceHeading eyebrow="SERVER HELP AND RECOVERY" title="Work safely with server records" description="Use the signed-in operator and outlet shown in the workspace header. Server commands remain online-only." />
    <div className="help-grid">
      <button type="button" onClick={() => onNavigate('sell')}><ShoppingCart /><span><strong>Make a sale</strong><small>Use the server catalogue and the current authorized till.</small></span><ArrowUpRight /></button>
      <button type="button" onClick={() => onNavigate('stock')}><PackageSearch /><span><strong>Review stock</strong><small>See the current server catalogue, balances and movements.</small></span><ArrowUpRight /></button>
      <button type="button" onClick={() => onNavigate('shifts')}><CreditCard /><span><strong>Cash-up</strong><small>Review expected cash and record the physical count at close.</small></span><ArrowUpRight /></button>
    </div>
    <section className="help-recovery"><div className="help-recovery-icon"><CircleHelp /></div><div><h2>Not sure whether a command completed?</h2><p>Use the server command recovery notice at the top of the page. Check the stored command status before repeating a sale, receipt or cash movement.</p></div></section>
    <div className="integration-boundary"><CircleHelp size={17} /><span>This session uses server records for connected workflows. Browser preview records and its sync simulator are separate and unavailable in this mode.</span></div>
  </div>;
  return <div className="page-stack">
    <WorkspaceHeading eyebrow="HELP AND RECOVERY" title="What are you trying to do?" description="Quick guidance for common tasks in the local preview." />
    <div className="help-grid">
      <button type="button" onClick={() => onNavigate('sell')}><ShoppingCart /><span><strong>Make a sale</strong><small>Find an item, build a basket, and take payment.</small></span><ArrowUpRight /></button>
      <button type="button" onClick={() => onNavigate('stock')}><PackageSearch /><span><strong>Check an item</strong><small>Review current quantities and stock movements.</small></span><ArrowUpRight /></button>
      <button type="button" onClick={() => onNavigate('shifts')}><CreditCard /><span><strong>Open or close a shift</strong><small>Review the till and count cash at close.</small></span><ArrowUpRight /></button>
      <button type="button" onClick={onOpenSyncCenter}><WifiOff /><span><strong>Something is waiting to sync</strong><small>Check the sync center before repeating an action.</small></span><ArrowUpRight /></button>
    </div>
    <section className="help-recovery"><div className="help-recovery-icon"><CircleHelp /></div><div><h2>Not sure whether an action saved?</h2><p>Open the sync center and review its status before trying again. A missing confirmation does not mean a payment or change failed.</p></div></section>
    <div className="integration-boundary"><CircleHelp size={17} /><span>This build is a local preview. Contact your system administrator for account access, device enrollment, data imports, or production support.</span></div>
  </div>;
}
