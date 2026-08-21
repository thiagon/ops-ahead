import { Link } from 'react-router';

export function meta() {
  return [{ title: 'Ops Ahead' }];
}

export default function Home() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="font-semibold text-3xl text-text-light">Ops Ahead</h1>
      <p className="mt-2 text-text-muted">A tela do gestor entra na próxima fase.</p>
      <Link
        to="/fila"
        className="mt-6 inline-block rounded-lg border border-border-base bg-bg-tile px-5 py-3 text-text-light hover:border-accent-red"
      >
        Fila de ocorrências
      </Link>
    </main>
  );
}
