import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '../app/session.ts';

beforeEach(() => {
  useSession.setState({ tenant: null, lastSlug: null, sidebarCollapsed: true });
});

describe('session store', () => {
  it('remembers the slug when entering a tenant and keeps it after leave', () => {
    useSession.getState().enter({ slug: 'locaweb', name: 'Locaweb' });

    expect(useSession.getState().tenant).toEqual({ slug: 'locaweb', name: 'Locaweb' });
    expect(useSession.getState().lastSlug).toBe('locaweb');

    useSession.getState().leave();

    expect(useSession.getState().tenant).toBeNull();
    expect(useSession.getState().lastSlug).toBe('locaweb');
  });

  it('toggles the sidebar without touching the tenant', () => {
    useSession.getState().enter({ slug: 'locaweb', name: 'Locaweb' });
    useSession.getState().setSidebarCollapsed(false);

    expect(useSession.getState().sidebarCollapsed).toBe(false);
    expect(useSession.getState().tenant?.slug).toBe('locaweb');
  });
});
