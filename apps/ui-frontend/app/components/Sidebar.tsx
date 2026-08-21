import { Link, useLocation } from 'react-router';
import { GridIcon, ListIcon, ShieldIcon } from './icons';

const NAV_ITEMS = [
  { to: '/', label: 'Painel do gestor', icon: GridIcon },
  { to: '/fila', label: 'Fila de ocorrências', icon: ListIcon },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex w-[86px] shrink-0 flex-col items-center border-border-base border-r bg-bg-elevated py-5">
      <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent-red to-signal-amber">
        <ShieldIcon className="h-6 w-6 text-text-light" />
      </div>

      <nav className="flex w-full flex-1 flex-col items-center gap-2">
        {NAV_ITEMS.map(item => {
          const active =
            item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.label}
              className={`relative flex h-11 w-11 items-center justify-center rounded-lg ${
                active
                  ? 'bg-accent-red/15 text-accent-red'
                  : 'text-text-muted hover:text-text-light'
              }`}
            >
              {active && (
                <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent-red" />
              )}
              <item.icon className="h-5 w-5" />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
