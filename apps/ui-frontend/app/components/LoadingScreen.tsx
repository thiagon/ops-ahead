import { PageHeader } from '~/components/PageHeader';

export function LoadingScreen({ title }: { title: string }) {
  return (
    <main className="p-6 sm:p-8">
      <PageHeader title={title} />
      <p className="text-sm text-text-muted">Carregando…</p>
    </main>
  );
}
