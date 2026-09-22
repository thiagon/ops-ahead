import { redirect } from 'react-router';

/**
 * Same-origin JSON read. A non-2xx body is the error the screen shows — the
 * request itself is visible in the browser network panel.
 */
export async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${url} não completou: ${message}`);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${response.status} ${url}\n${text.slice(0, 2000)}`);
    }
  }

  const record =
    payload && typeof payload === 'object'
      ? (payload as { redirect?: unknown; error?: unknown; cause?: unknown })
      : undefined;

  if (response.status === 401 && typeof record?.redirect === 'string') {
    throw redirect(record.redirect);
  }

  if (!response.ok) {
    const detail = [record?.error, record?.cause]
      .filter(value => typeof value === 'string')
      .join('\n');
    const message = detail || text || response.statusText;
    if (response.status === 404) throw new Response(message, { status: 404 });
    throw new Error(`${response.status} ${url}\n${message}`);
  }

  return payload as T;
}
