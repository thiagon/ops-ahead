import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  originErrorSchema,
  originParamsSchema,
  originRegistrationSchema,
  originSummarySchema,
  originWithSecretSchema,
  secretRotationSchema,
} from '../../services/origins/schema.ts';

export function registerOriginRoutes(app: FastifyInstance): void {
  const origins = app.services.origins;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/origins',
    {
      schema: {
        tags: ['origins'],
        summary: 'List the origins the gateway accepts',
        description: 'Secrets are never included — a lost one is replaced by rotating it.',
        response: { 200: z.array(originSummarySchema) },
      },
    },
    async () => origins.list(),
  );

  typed.put(
    '/origins/:tenant/:source',
    {
      schema: {
        tags: ['origins'],
        summary: 'Register an origin',
        description:
          'Answers with the secret this origin signs with, this once and never again. Idempotent on the pair — a second PUT replaces the secret.',
        params: originParamsSchema,
        body: originRegistrationSchema,
        response: { 200: originWithSecretSchema, 400: originErrorSchema },
      },
    },
    async request => {
      const { tenant, source } = request.params;
      const { intake, secret } = request.body;
      return origins.register(tenant, source, intake, secret);
    },
  );

  typed.post(
    '/origins/:tenant/:source/secret',
    {
      schema: {
        tags: ['origins'],
        summary: "Rotate an origin's secret",
        description:
          'The previous secret stops being accepted, so the origin has to start signing with the new one right away. Answers with it this once and never again.',
        params: originParamsSchema,
        body: secretRotationSchema,
        response: {
          200: originWithSecretSchema,
          400: originErrorSchema,
          404: originErrorSchema,
        },
      },
    },
    async request => {
      const { tenant, source } = request.params;
      return origins.rotate(tenant, source, request.body.secret);
    },
  );
}
