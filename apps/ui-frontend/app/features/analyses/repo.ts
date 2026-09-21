import type { AnalysisRequest } from './payload.ts';
import type { AnalysisRun } from './types.ts';

export type GatewayCall = (path: string, init?: RequestInit) => Promise<Response>;

type ErrorBody = {
  error?: string;
  message?: string;
};

function errorMessage(body: unknown, text: string, fallback: string): string {
  const record = body && typeof body === 'object' ? (body as ErrorBody) : null;
  if (typeof record?.message === 'string' && record.message.length > 0) return record.message;
  if (typeof record?.error === 'string' && record.error.length > 0) return record.error;
  const trimmed = text.trim();
  return trimmed || fallback;
}

/** Reads and writes for one tenant's analyses, against whichever gateway hop the caller wired. */
export function createAnalysesRepo(tenant: string, api: GatewayCall) {
  async function expectOk(response: Response, fallback: string): Promise<unknown> {
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (response.ok) return body;
    throw new Error(`${response.status} ${response.url}: ${errorMessage(body, text, fallback)}`);
  }

  /**
   * Every run, whatever started it. Filtering to `manual` would hide the
   * daily chain and the trainings it chains off itself — the runs somebody
   * looking at this screen most needs to see, and the ones they cannot start
   * again from anywhere else.
   */
  async function list(limit = 30): Promise<AnalysisRun[]> {
    const body = await expectOk(
      await api(`/${encodeURIComponent(tenant)}/analyses?limit=${limit}`),
      'Falha ao listar as análises.',
    );
    return Array.isArray(body) ? (body as AnalysisRun[]) : [];
  }

  async function start(body: AnalysisRequest): Promise<{ id: string }> {
    const accepted = (await expectOk(
      await api(`/${encodeURIComponent(tenant)}/analyses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      'Não foi possível iniciar a análise.',
    )) as { id?: unknown };
    if (typeof accepted?.id !== 'string') {
      throw new Error('O gateway aceitou a análise sem devolver um id.');
    }
    return { id: accepted.id };
  }

  return { list, start };
}
