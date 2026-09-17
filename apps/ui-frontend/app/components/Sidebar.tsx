import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  GridIcon,
  ListIcon,
  MenuIcon,
  ShieldIcon,
} from './icons';

type NavItem = {
  to: string;
  label: string;
  hint: string;
  icon: typeof ListIcon;
  badge?: 'openCount';
};

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Operação',
    items: [
      {
        to: '/',
        label: 'Painel N1/N2',
        hint: 'Fila priorizada e o motivo de cada score',
        icon: GridIcon,
      },
      {
        to: '/fila',
        label: 'Fila',
        hint: 'Todas as ocorrências vivas, por prazo',
        icon: ListIcon,
        badge: 'openCount',
      },
    ],
  },
  {
    title: 'Gestão',
    items: [
      {
        to: '/painel-gestor',
        label: 'Painel do gestor',
        hint: 'Meta anual, projeção e tendências',
        icon: ClockIcon,
      },
    ],
  },
];

const COLLAPSED_KEY = 'ops-ahead:sidebar-collapsed';

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

/**
 * Reading localStorage during render would desync the server HTML from the
 * first client paint, so the stored choice is applied after hydration.
 */
function useCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) !== 'false');
    } catch {
      // A browser that refuses storage still gets the default.
    }
  }, []);

  return [
    collapsed,
    (next: boolean) => {
      setCollapsed(next);
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        // Persisting is a convenience; the toggle itself still works.
      }
    },
  ];
}

function NavLinks({
  collapsed,
  openCount,
  onNavigate,
}: {
  collapsed: boolean;
  openCount: number | null;
  onNavigate?: () => void;
}) {
  const location = useLocation();

  return (
    <nav className="flex w-full flex-1 flex-col gap-6 px-3">
      {NAV_GROUPS.map(group => (
        <div key={group.title} className="flex flex-col gap-1">
          {!collapsed && (
            <p className="px-2 pb-1 font-semibold text-[10px] text-text-dim uppercase tracking-widest">
              {group.title}
            </p>
          )}
          {group.items.map(item => {
            const active = isActive(location.pathname, item.to);
            const badge = item.badge === 'openCount' ? openCount : null;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                title={collapsed ? `${item.label} — ${item.hint}` : undefined}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-11 items-center gap-3 rounded-lg px-2.5 transition-colors ${
                  collapsed ? 'justify-center' : ''
                } ${
                  active
                    ? 'bg-accent-red/15 text-accent-red'
                    : 'text-text-muted hover:bg-white/[0.04] hover:text-text-light'
                }`}
              >
                {active && (
                  <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent-red" />
                )}
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate font-medium text-sm">
                      {item.label}
                    </span>
                    {badge !== null && badge > 0 && (
                      <span className="shrink-0 rounded-full bg-accent-red/15 px-2 py-0.5 font-bold text-[10px] text-accent-red">
                        {badge}
                      </span>
                    )}
                  </>
                )}
                {collapsed && badge !== null && badge > 0 && (
                  <span className="-top-0.5 -right-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-red px-1 font-bold text-[10px] text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 ${collapsed ? 'justify-center' : ''}`}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-red to-signal-amber">
        <ShieldIcon className="h-6 w-6 text-text-light" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm text-text-light">Ops Ahead</p>
          <p className="truncate text-text-dim text-xs">AIOps Locaweb</p>
        </div>
      )}
    </div>
  );
}

function SessionBlock({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 ${collapsed ? 'justify-center' : ''}`}>
      <div
        title={collapsed ? 'Sessão anônima — SSO ainda não integrado' : undefined}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-tile font-semibold text-text-muted text-xs"
      >
        N1
        <span className="-right-0.5 -bottom-0.5 absolute h-2.5 w-2.5 rounded-full border-2 border-bg-elevated bg-signal-green" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm text-text-light">Operador N1</p>
          <p className="truncate text-text-dim text-xs">Sessão anônima</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ openCount }: { openCount: number | null }) {
  const [collapsed, setCollapsed] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Abrir navegação"
        aria-expanded={drawerOpen}
        className="fixed top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-border-base bg-bg-elevated text-text-muted hover:text-text-light sm:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {drawerOpen && (
        <button
          type="button"
          aria-label="Fechar navegação"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 sm:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col gap-6 border-border-base border-r bg-bg-elevated py-5 transition-transform sm:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between pr-3">
          <Brand collapsed={false} />
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar navegação"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:text-text-light"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <NavLinks collapsed={false} openCount={openCount} onNavigate={() => setDrawerOpen(false)} />
        <SessionBlock collapsed={false} />
      </aside>

      {/* The nav stays put while a long screen scrolls: the aside is a sticky
          viewport-tall column, not a sibling that grows with the page. */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 self-start flex-col gap-6 overflow-y-auto border-border-base border-r bg-bg-elevated py-5 transition-[width] sm:flex ${
          collapsed ? 'w-[86px]' : 'w-[240px]'
        }`}
      >
        <div
          className={`flex items-center gap-2 ${collapsed ? 'flex-col' : 'justify-between pr-3'}`}
        >
          <Brand collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
            title={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-white/[0.04] hover:text-text-light"
          >
            {collapsed ? (
              <ChevronRightIcon className="h-4 w-4" />
            ) : (
              <ChevronLeftIcon className="h-4 w-4" />
            )}
          </button>
        </div>
        <NavLinks collapsed={collapsed} openCount={openCount} />
        <SessionBlock collapsed={collapsed} />
      </aside>
    </>
  );
}
