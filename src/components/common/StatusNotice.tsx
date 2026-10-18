import React from 'react';
import { AlertCircle, CheckCircle2, Info, WifiOff } from 'lucide-react';
import type { CommandStatus } from '../../types/ui';

const copy: Record<CommandStatus, { title: string; detail: string; tone: string; icon: React.ReactNode }> = {
  editing: { title: 'Draft', detail: 'Changes are still being edited.', tone: 'neutral', icon: <Info /> },
  validating: { title: 'Checking details', detail: 'Reviewing this action before it is sent.', tone: 'info', icon: <Info /> },
  sending: { title: 'Sending', detail: 'Keep this window open while we confirm the result.', tone: 'info', icon: <Info /> },
  confirmed: { title: 'Confirmed', detail: 'Action completed.', tone: 'success', icon: <CheckCircle2 /> },
  rejected: { title: 'Not completed', detail: 'The action was rejected. Review the reason before editing.', tone: 'danger', icon: <AlertCircle /> },
  outcome_unknown: { title: 'Checking save status', detail: 'The response was interrupted. This action may have completed; check its status before retrying.', tone: 'warning', icon: <AlertCircle /> },
  local_only: { title: 'Saved on this device', detail: 'This change is saved only on this device and has not been confirmed.', tone: 'warning', icon: <WifiOff /> },
  pending_sync: { title: 'Waiting to sync', detail: 'This device has saved the action locally. It is still waiting for confirmation.', tone: 'warning', icon: <WifiOff /> },
  conflict: { title: 'Changed elsewhere', detail: 'Review the latest details before trying again.', tone: 'danger', icon: <AlertCircle /> },
};

export function StatusNotice({ status, commandId, onCheckStatus, onReviewActivity }: {
  status: CommandStatus;
  commandId?: string;
  onCheckStatus?: (commandId: string) => void;
  onReviewActivity?: (commandId: string) => void;
}) {
  const item = copy[status];
  const unknown = status === 'outcome_unknown' && commandId;
  return <section className={`status-notice status-${item.tone}`} role="status" aria-live="polite">
    <span className="status-notice-icon" aria-hidden="true">{item.icon}</span>
    <div className="status-notice-copy"><strong>{item.title}</strong><span>{item.detail}</span></div>
    {unknown && <div className="status-notice-actions">
      <button type="button" onClick={() => onCheckStatus?.(commandId)}>Check status</button>
      <button type="button" onClick={() => onReviewActivity?.(commandId)}>Review activity</button>
    </div>}
  </section>;
}
