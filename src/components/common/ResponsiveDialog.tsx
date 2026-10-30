import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ResponsiveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'max-w-md' | 'max-w-lg' | 'max-w-2xl';
}

export const ResponsiveDialog: React.FC<ResponsiveDialogProps> = ({
  isOpen,
  onClose,
  closeDisabled = false,
  title,
  subtitle,
  icon,
  children,
  footerActions,
  maxWidth = 'md',
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []);
    const focusFrame = requestAnimationFrame(() => {
      // An operator may focus a field before this scheduled initial focus runs.
      // Preserve that focus so their first keystrokes stay in the chosen field.
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) focusable()[0]?.focus();
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const normalizedWidth = maxWidth.replace('max-w-', '');
  const maxWidthClass =
    normalizedWidth === 'sm'
      ? 'sm:max-w-sm'
      : normalizedWidth === 'md'
      ? 'sm:max-w-md'
      : normalizedWidth === 'lg'
      ? 'sm:max-w-lg'
      : normalizedWidth === 'xl'
      ? 'sm:max-w-xl'
      : 'sm:max-w-2xl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className={`relative w-full ${maxWidthClass} max-h-[92vh] sm:max-h-[85vh] bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-100`}
      >
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden flex justify-center pt-2 pb-1 bg-zinc-950/80">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Dialog Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-zinc-800 bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h3 id={titleId} className="text-sm sm:text-base font-semibold text-zinc-100 truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-zinc-400 font-mono truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={closeDisabled}
            className="p-2 sm:p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Dialog Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs sm:text-sm">
          {children}
        </div>

        {/* Sticky Dialog Footer */}
        {footerActions && (
          <div className="px-5 sm:px-6 py-3.5 sm:py-4 bg-zinc-950/90 border-t border-zinc-800 flex items-center justify-end gap-2.5 shrink-0">
            {footerActions}
          </div>
        )}
      </div>
    </div>
  );
};
