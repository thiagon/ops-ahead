import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TenantRef } from '~/types';

/**
 * Client session: the tenant the operator is in, and chrome that should
 * survive a reload. Server data stays in the loaders — this store never
 * caches query results or the config registry.
 *
 * The URL slug remains the source of truth. `enter` mirrors it after the
 * layout loader has resolved, so the chrome can read the session without
 * threading props. Persist skips hydration so the server HTML and the first
 * client paint stay in sync.
 */
type SessionState = {
  tenant: TenantRef | null;
  lastSlug: string | null;
  sidebarCollapsed: boolean;
  enter: (tenant: TenantRef) => void;
  leave: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

export const useSession = create<SessionState>()(
  persist(
    set => ({
      tenant: null,
      lastSlug: null,
      sidebarCollapsed: true,
      enter: tenant => set({ tenant, lastSlug: tenant.slug }),
      leave: () => set({ tenant: null }),
      setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),
    }),
    {
      name: 'ops-ahead:session',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ lastSlug, sidebarCollapsed }) => ({ lastSlug, sidebarCollapsed }),
      skipHydration: true,
    },
  ),
);

/** Call once from the root so persisted chrome is applied after hydration. */
export function useHydrateSession(): void {
  useEffect(() => {
    void useSession.persist.rehydrate();
  }, []);
}
