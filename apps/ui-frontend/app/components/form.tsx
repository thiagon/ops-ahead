export const inputClass =
  'h-10 w-full rounded-lg border border-border-base bg-bg-elevated px-3 text-sm text-text-light outline-none transition-colors placeholder:text-text-dim focus:border-signal-blue/60';

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-semibold text-[11px] text-text-dim uppercase tracking-wider"
      >
        {label}
      </label>
      {children(id)}
      {hint && <span className="text-text-dim text-xs">{hint}</span>}
    </div>
  );
}

/** Sits beside an input, so it matches the input's height and never wraps. */
export function InputButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border-base px-3 font-medium text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-light"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-2 rounded-lg border border-border-base px-3 font-medium text-sm transition-colors ${
        tone === 'danger'
          ? 'text-text-muted hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red'
          : 'text-text-muted hover:bg-white/[0.04] hover:text-text-light'
      }`}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-2 rounded-lg bg-accent-red px-4 font-semibold text-sm text-text-light transition-opacity hover:opacity-90"
    >
      {children}
    </button>
  );
}
