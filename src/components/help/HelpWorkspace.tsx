import React from 'react';
import { ArrowUpRight, CircleHelp, CreditCard, PackageSearch, ShoppingCart, WifiOff } from 'lucide-react';
import type { WorkspaceId } from '../../types/ui';
import { WorkspaceHeading } from '../common/WorkspacePrimitives';

export function HelpWorkspace({ onNavigate, onOpenSyncCenter }: { onNavigate: (workspace: WorkspaceId) => void; onOpenSyncCenter: () => void }) {
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
