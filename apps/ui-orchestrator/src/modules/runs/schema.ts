import { z } from 'zod';

export const runStatusSchema = z
  .object({
    run_id: z.string(),
    status: z.enum(['queued', 'Running', 'Succeeded', 'Failed']),
    started_at: z.iso.datetime().optional(),
    finished_at: z.iso.datetime().optional(),
    // App- and status-specific context (e.g. mlflow_run_id on success, error
    // message on failure) — deliberately not rigidly typed, see payloads.md.
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'RunStatus' });

export type RunStatus = z.infer<typeof runStatusSchema>;

export const runParamsSchema = z.object({
  run_id: z.string().min(1),
});
