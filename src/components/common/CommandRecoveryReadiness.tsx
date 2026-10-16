export function CommandRecoveryReadiness({ ready, error, retry }: { ready: boolean; error: string; retry: () => void }) {
  if (ready) return null;
  return <div role={error ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
    <span>{error ? `Saved command recovery could not be checked. ${error} Restore browser storage, then retry. New actions remain unavailable.` : 'Checking saved command recovery before enabling new actions…'}</span>
    {error && <button type="button" onClick={retry} className="min-h-11 rounded-lg border border-amber-700 px-4 font-semibold underline">Retry recovery check</button>}
  </div>;
}
