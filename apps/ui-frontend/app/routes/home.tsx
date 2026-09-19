import { Form, redirect, useNavigation } from 'react-router';
import { inputClass } from '~/components/form';
import { Logo } from '~/components/Logo';
import { getTenantBySlug } from '~/features/config/repo.server.ts';
import { panelPath } from '~/paths';
import { useSession } from '~/session';
import type { Route } from './+types/home';

export function meta() {
  return [{ title: 'Ops Ahead' }];
}

const SLUG_PATTERN = '^[a-z][a-z0-9_-]*$';

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const slug = String(form.get('tenant') ?? '')
    .trim()
    .toLowerCase();

  if (!slug || !new RegExp(SLUG_PATTERN).test(slug)) {
    return { error: 'Use só letras minúsculas, números, hífen e underscore.' };
  }

  const tenant = await getTenantBySlug(slug).catch(error => {
    console.error(error);
    return undefined;
  });
  if (tenant === undefined) {
    return { error: 'Não foi possível entrar agora. Tente de novo.' };
  }
  if (!tenant) {
    return { error: 'Cliente não encontrado.' };
  }

  return redirect(panelPath(tenant.slug));
}

export default function Home({ actionData }: Route.ComponentProps) {
  const saving = useNavigation().state === 'submitting';
  const lastSlug = useSession(state => state.lastSlug);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-semibold text-text-light">Ops Ahead</p>
            <p className="text-text-dim text-xs">Sempre à frente</p>
          </div>
        </div>

        <h1 className="font-bold text-2xl text-text-light">Entrar no cliente</h1>

        <Form method="post" className="mt-8 flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="tenant"
              className="font-semibold text-[11px] text-text-dim uppercase tracking-wider"
            >
              Cliente
            </label>
            <input
              id="tenant"
              name="tenant"
              required
              // biome-ignore lint/a11y/noAutofocus: sole field of the entry screen
              autoFocus
              autoComplete="off"
              spellCheck={false}
              pattern={SLUG_PATTERN}
              placeholder="locaweb"
              defaultValue={lastSlug ?? ''}
              key={lastSlug ?? 'empty'}
              className={`${inputClass} font-mono`}
            />
          </div>

          {actionData?.error && <p className="text-accent-red text-sm">{actionData.error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="flex h-10 items-center justify-center rounded-lg bg-accent-red px-4 font-semibold text-sm text-text-light transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Entrando…' : 'Entrar'}
          </button>
        </Form>
      </div>
    </main>
  );
}
