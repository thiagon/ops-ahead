import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest, preParsingAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import createError from 'http-errors';
import type { OriginCredential } from './origin-registry.ts';

const SIGNATURE_HEADER = 'x-signature';
const SIGNATURE_PREFIX = 'sha256=';

const DEFAULT_BODY_LIMIT = 1024 * 1024;

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * `credential` is resolved per request: the accepted origins come from
     * configuration, so which credential signs a request is known only once
     * the URL is matched (see plugins/origin-registry.ts).
     */
    verifySignatureFor: (
      resolve: (request: FastifyRequest) => OriginCredential | undefined,
    ) => preParsingAsyncHookHandler;
  }
}

export type SignatureCheck = 'valid' | 'missing' | 'invalid';

/**
 * Verify `X-Signature: sha256=<hex>` against the HMAC of the raw body. The
 * comparison is constant-time so a wrong signature tells the caller nothing
 * about how wrong it was. It runs over the bytes as they arrived — re-encoding
 * a parsed body would change the digest for the same event.
 */
export function checkSignature(
  header: string | undefined,
  body: Buffer | string,
  secret: string,
): SignatureCheck {
  if (!header) return 'missing';
  if (!header.startsWith(SIGNATURE_PREFIX)) return 'invalid';

  const provided = Buffer.from(header.slice(SIGNATURE_PREFIX.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (provided.length !== expected.length) return 'invalid';

  return timingSafeEqual(provided, expected) ? 'valid' : 'invalid';
}

/**
 * Exposes `app.verifySignatureFor(credential)` — one hook per registered
 * (tenant, source) credential, each checking against that credential's own
 * secret. A route opts in with `preParsing: app.verifySignatureFor(credential)`;
 * nothing else on the app pays for it, and no route can be verified against
 * another tenant's secret.
 *
 * It runs at preParsing, before the body is parsed: the signature covers the
 * bytes on the wire, and an unsigned caller never gets a payload parsed on its
 * behalf, so a malformed body answers 401 instead of a parser error.
 */
async function hmacPlugin(fastify: FastifyInstance) {
  const verifySignatureFor = (
    resolve: (request: FastifyRequest) => OriginCredential | undefined,
  ): preParsingAsyncHookHandler => {
    return async (request, _reply, payload) => {
      const credential = resolve(request);
      if (!credential) {
        throw createError.NotFound('no integration is configured for this address');
      }
      if (!fastify.env.HMAC_ENABLED) return payload;

      const limit =
        request.routeOptions.bodyLimit ?? fastify.initialConfig.bodyLimit ?? DEFAULT_BODY_LIMIT;

      // Buffering takes over what the content-type parser would do, so the body
      // limit has to be honored here too.
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of payload) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > limit) {
          throw createError.PayloadTooLarge('request body exceeds the configured limit');
        }
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks);

      const secret =
        (fastify.env as unknown as Record<string, string | undefined>)[credential.hmacSecretEnv] ??
        '';
      const header = request.headers[SIGNATURE_HEADER];
      const outcome = checkSignature(typeof header === 'string' ? header : undefined, body, secret);

      if (outcome !== 'valid') {
        // app.metrics is read here, not at registration: autoload brings the
        // metrics plugin up after this one, and by request time it is decorated.
        fastify.metrics.signatureFailures.inc({
          reason: outcome,
          tenant_id: credential.tenantId,
          source: credential.source,
        });
        request.log.warn(
          { reason: outcome, url: request.url, tenant_id: credential.tenantId },
          'rejected an unsigned request',
        );
        throw createError.Unauthorized('missing or invalid X-Signature header');
      }

      // The consumed stream is handed back so parsing proceeds as usual.
      return Readable.from(body);
    };
  };

  fastify.decorate('verifySignatureFor', verifySignatureFor);
}

export default fp(hmacPlugin, { name: 'hmac', dependencies: ['env'] });
