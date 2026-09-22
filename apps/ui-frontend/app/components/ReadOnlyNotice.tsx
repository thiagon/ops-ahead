export function ReadOnlyNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-lg border border-border-base bg-bg-elevated px-4 py-3 text-sm text-text-muted">
      <span className="font-medium text-text-light">Somente leitura.</span> {children}
    </p>
  );
}
