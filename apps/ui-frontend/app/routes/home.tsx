export function meta() {
  return [{ title: 'Ops Ahead' }];
}

export default function Home() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="font-semibold text-3xl text-text-light">Ops Ahead</h1>
      <p className="mt-2 text-text-muted">
        As telas do operador e do gestor entram nas próximas fases.
      </p>
    </main>
  );
}
