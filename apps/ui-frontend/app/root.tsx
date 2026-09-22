import type { ReactNode } from 'react';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router';
import type { Route } from './+types/root';
import logo from './assets/logo.png';
import { getConfig } from './config.server.ts';
import { useHydrateSession } from './session';
import './app.css';

export function loader() {
  return { gatewayUrl: getConfig().PUBLIC_GATEWAY_URL };
}

export function links() {
  return [{ rel: 'icon', href: logo, type: 'image/png' }];
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData('root') as { gatewayUrl?: string } | undefined;
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="gateway-url" content={data?.gatewayUrl ?? ''} />
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
  } else if (error instanceof Error) {
    details = error.message;
    stack = error.stack;
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
