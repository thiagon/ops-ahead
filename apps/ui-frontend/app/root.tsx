import type { ReactNode } from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { useHydrateSession } from './session';
import './app.css';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useHydrateSession();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Erro';
  let details = 'Ocorreu um erro inesperado.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Erro';
    details =
      error.status === 404 ? 'A página solicitada não existe.' : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    // Registry / Prisma messages name tables and files — they stay in the
    // server log. The screen only says something failed.
    const fromRegistry = /PrismaClient|Invalid `|Error converting field/i.test(error.message);
    if (!fromRegistry) {
      details = error.message;
      stack = error.stack;
    }
  }

  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl text-accent-red">{message}</h1>
      <p className="text-text-muted">{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4 font-mono text-text-dim">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
