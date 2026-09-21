import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  analysesPath,
  deadlinesPath,
  integrationsPath,
  managerPath,
  panelPath,
  queuePath,
  targetsPath,
} from '~/paths';
import { useSession } from '~/session';
import type { TenantRef } from '~/types';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  GridIcon,
  ListIcon,
  MenuIcon,
  PlugIcon,
  PulseIcon,
  TrendingUpIcon,
} from './icons';
import { Logo } from './Logo';

type NavLink = {
  to: string;
  label: string;
  hint: string;
  icon: typeof ListIcon;
  badge?: 'openCount';
};

type NavEntry = NavLink | { label: string; items: NavLink[] };

function navGroups(tenant: string): Array<{ title: string; items: NavEntry[] }> {
  return [
    {
      title: 'Operação',
      items: [
        {
          to: panelPath(tenant),
          label: 'Painel N1/N2',
          hint: 'Fila priorizada e o motivo de cada score',
          icon: GridIcon,
        },
        {
          to: queuePath(tenant),
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
          to: managerPath(tenant),
          label: 'Painel do gestor',
          hint: 'Meta anual, projeção e tendências',
          icon: ClockIcon,
        },
        {
          to: analysesPath(tenant),
          label: 'Análises',
          hint: 'Disparar e acompanhar qualquer execução',
          icon: PulseIcon,
        },
      ],
    },
    {
      title: 'Ajustes',
      items: [
        {
          to: targetsPath(tenant),
          label: 'Metas',
          hint: 'Teto anual de violações',
          icon: TrendingUpIcon,
        },
        {
          to: deadlinesPath(tenant),
          label: 'Prazos',
          hint: 'Tempo máximo de atendimento por prioridade',
          icon: CalendarIcon,
        },
        {
          label: 'Integrações',
          items: [
            {
              to: integrationsPath(tenant),
              label: 'Entrada',
              hint: 'Sistemas de origem que enviam eventos',
              icon: PlugIcon,
            },
          ],
        },
      ],
    },
  ];
}

function isLink(item: NavEntry): item is NavLink {
  return 'to' in item;
}

function isActive(pathname: string, to: string, panel: string): boolean {
  return to === panel ? pathname === to : pathname.startsWith(to);
}

function NavLinkItem({
  item,
  collapsed,
  nested,
  pathname,
  panel,
  openCount,
  onNavigate,
}: {
  item: NavLink;
  collapsed: boolean;
  nested?: boolean;
  pathname: string;
  panel: string;
  openCount: number | null;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.to, panel);
  const badge = item.badge === 'openCount' ? openCount : null;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? `${item.label} — ${item.hint}` : undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-11 items-center gap-3 rounded-lg px-2.5 transition-colors ${
        collapsed ? 'justify-center' : nested ? 'pl-5' : ''
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
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{item.label}</span>
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
}

function NavLinks({
  tenant,
  collapsed,
  openCount,
  onNavigate,
}: {
  tenant: string;
  collapsed: boolean;
  openCount: number | null;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const panel = panelPath(tenant);

  return (
    <nav className="flex w-full flex-1 flex-col gap-6 px-3">
      {navGroups(tenant).map(group => (
        <div key={group.title} className="flex flex-col gap-1">
          {!collapsed && (
            <p className="px-2 pb-1 font-semibold text-[10px] text-text-dim uppercase tracking-widest">
              {group.title}
            </p>
          )}
          {group.items.map(item => {
            if (isLink(item)) {
              return (
                <NavLinkItem
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  pathname={location.pathname}
                  panel={panel}
                  openCount={openCount}
                  onNavigate={onNavigate}
                />
              );
            }
            return (
              <div key={item.label} className="flex flex-col gap-1">
                {!collapsed && (
                  <p className="px-2 pt-2 pb-1 font-semibold text-[10px] text-text-dim uppercase tracking-widest">
                    {item.label}
                  </p>
                )}
                {item.items.map(child => (
                  <NavLinkItem
                    key={child.to}
                    item={child}
                    collapsed={collapsed}
                    nested
                    pathname={location.pathname}
                    panel={panel}
                    openCount={openCount}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ tenant, collapsed }: { tenant: TenantRef; collapsed: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 ${collapsed ? 'justify-center' : ''}`}>
      <Logo alt={collapsed ? 'Ops Ahead' : ''} />
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm text-text-light">Ops Ahead</p>
          <p className="truncate text-text-dim text-xs">{tenant.name}</p>
        </div>
      )}
    </div>
  );
}

function SessionBlock({ collapsed }: { collapsed: boolean }) {
  const leave = useSession(state => state.leave);
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
          <p className="truncate text-text-dim text-xs">
            <Link to="/" onClick={() => leave()} className="hover:text-text-light">
              Trocar cliente
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ tenant, openCount }: { tenant: TenantRef; openCount: number | null }) {
  const collapsed = useSession(state => state.sidebarCollapsed);
  const setCollapsed = useSession(state => state.setSidebarCollapsed);
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
          <Brand tenant={tenant} collapsed={false} />
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar navegação"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:text-text-light"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <NavLinks
          tenant={tenant.slug}
          collapsed={false}
          openCount={openCount}
          onNavigate={() => setDrawerOpen(false)}
        />
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
          <Brand tenant={tenant} collapsed={collapsed} />
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
        <NavLinks tenant={tenant.slug} collapsed={collapsed} openCount={openCount} />
        <SessionBlock collapsed={collapsed} />
      </aside>
    </>
  );
}
