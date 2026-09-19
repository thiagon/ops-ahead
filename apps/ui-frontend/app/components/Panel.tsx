export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border-base bg-bg-tile p-6 ${className ?? ''}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-text-light text-xl">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
