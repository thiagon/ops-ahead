import { createHmac } from 'node:crypto';

const BODY_LIMIT = 1_000_000;
const POST_TIMEOUT_MS = 8_000;

export type WebhookPostResult = {
  status: number;
  ok: boolean;
  body: string;
};

/** Same header the gateway verifies: `X-Signature: sha256=<hex>`. */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function validateWebhookBody(body: string): string | null {
  if (!body.trim()) return 'O corpo do envio está vazio.';
  if (body.length > BODY_LIMIT) return 'O corpo ultrapassa o limite de 1 MB.';
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'O corpo precisa ser um objeto JSON.';
    }
  } catch {
    return 'O corpo não é JSON válido.';
  }
  return null;
}

/**
 * Posts the body bytes as typed — re-encoding would change the HMAC. The URL
 * is computed by the caller from the integration, never taken from the form.
 */
export async function postToWebhook(
  url: string,
  body: string,
  secret: string,
): Promise<WebhookPostResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers['x-signature'] = signWebhookBody(secret, body);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });

  return {
    status: response.status,
    ok: response.ok,
    body: (await response.text()).slice(0, 4_000),
  };
}

export function unreachableWebhookMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/aborted|timeout|ECONNREFUSED|fetch failed|ENOTFOUND|network/i.test(message)) {
    return 'Não foi possível alcançar o endereço de envio.';
  }
  return 'O envio falhou.';
}
