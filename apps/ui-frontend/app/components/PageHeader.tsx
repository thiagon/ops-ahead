export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  // The mobile menu button is fixed at the top-left corner; the left padding
  // keeps the title clear of it until the sidebar takes over at sm.
  return (
    <div className="mb-6 flex flex-col gap-4 pl-14 sm:flex-row sm:items-start sm:justify-between sm:pl-0">
      <div>
        {breadcrumb && <div className="mb-2">{breadcrumb}</div>}
        <h1 className="font-bold text-2xl text-text-light">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  );
}
