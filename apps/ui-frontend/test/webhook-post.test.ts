import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  postToWebhook,
  signWebhookBody,
  unreachableWebhookMessage,
  validateWebhookBody,
} from '../app/features/config/webhook-post.server.ts';

describe('signWebhookBody', () => {
  it('matches the gateway header over the exact body bytes', () => {
    const body = '{"ticket_number":"INC1"}';
    const expected = `sha256=${createHmac('sha256', 'sekret').update(body).digest('hex')}`;
    expect(signWebhookBody('sekret', body)).toBe(expected);
  });
});

describe('validateWebhookBody', () => {
  it('accepts a JSON object and rejects anything else', () => {
    expect(validateWebhookBody('{"a":1}')).toBeNull();
    expect(validateWebhookBody('')).toBe('O corpo do envio está vazio.');
    expect(validateWebhookBody('[]')).toBe('O corpo precisa ser um objeto JSON.');
    expect(validateWebhookBody('"x"')).toBe('O corpo precisa ser um objeto JSON.');
    expect(validateWebhookBody('{')).toBe('O corpo não é JSON válido.');
  });
});

describe('postToWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the typed bytes and signs when a key is given', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://gateway.example/webhook/v1/locaweb/itsm');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('{"a":1}');
      expect(new Headers(init?.headers).get('x-signature')).toBe(signWebhookBody('sekret', '{"a":1}'));
      return new Response('{"event_id":"abc"}', { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToWebhook(
      'https://gateway.example/webhook/v1/locaweb/itsm',
      '{"a":1}',
      'sekret',
    );

    expect(result).toEqual({ status: 202, ok: true, body: '{"event_id":"abc"}' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('omits the signature when no key is given', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('x-signature')).toBe(false);
      return new Response('denied', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToWebhook('https://gateway.example/webhook/v1/t/s', '{}', '');
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
  });
});

describe('unreachableWebhookMessage', () => {
  it('names a down gateway without leaking the internal error', () => {
    expect(unreachableWebhookMessage(new Error('fetch failed'))).toBe(
      'Não foi possível alcançar o endereço de envio.',
    );
    expect(unreachableWebhookMessage(new Error('boom'))).toBe('O envio falhou.');
  });
});
