/** Minimal GET /rules/schema body — same oneOf / anyOf shape the gateway emits. */

const labels = {
  description:
    'Path to a map the origin already sends, or several origin fields joined into labels.',
  anyOf: [
    { type: 'string', pattern: '^[^.]+(\\.[^.]+)*$' },
    {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
        required: ['key', 'path'],
      },
    },
  ],
};

const path = (description: string) => ({ type: 'string', description });

export const RULES_SCHEMA = {
  mapping: {
    oneOf: [
      {
        type: 'object',
        properties: {
          intake: { type: 'string', const: 'alert' },
          bindings: {
            type: 'object',
            properties: {
              external_id: path('Identity in the origin, e.g. a ticket number'),
              opened_at: path('When the incident was opened'),
              acknowledged_at: path('When someone took ownership'),
              resolved_at: path('When the cause was resolved'),
              closed_at: path('When the incident was closed'),
              severity: path("Origin's own severity/priority label, translated to 1–5"),
              status: path('Lifecycle state, translated by the dictionary'),
              entity_id: path('What was affected'),
              title: path('One-line summary'),
              description: path('Full description'),
              owner: path('Who currently holds the incident'),
              reported_by: path('How it was opened — translated to automatic/manual'),
              parent_id: path('Parent incident, when the origin has one'),
              resolution_code: path('How the incident ended, translated by the dictionary'),
              resolution_summary: path('What was done to close it'),
              labels,
              source_url: path('Link back to the incident in the origin'),
            },
            required: ['external_id', 'opened_at', 'severity', 'status', 'title'],
          },
          mappings: {
            type: 'object',
            properties: {
              status: {
                description: 'Lifecycle of the incident. An unmapped value becomes unknown.',
                additionalProperties: {
                  type: 'string',
                  enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed', 'canceled'],
                },
              },
              severity: {
                additionalProperties: { type: 'string', enum: ['1', '2', '3', '4', '5'] },
              },
              reported_by: {
                additionalProperties: { type: 'string', enum: ['automatic', 'manual'] },
              },
              resolution_code: {
                additionalProperties: { type: 'string' },
              },
            },
          },
        },
      },
      {
        type: 'object',
        properties: {
          intake: { type: 'string', const: 'monitor' },
          bindings: {
            type: 'object',
            properties: {
              external_id: path('Identity in the origin'),
              started_at: path('When the condition started firing'),
              ended_at: path('When it cleared — omit while the origin has no end'),
              severity: path("Origin's own severity label, translated to 1–5"),
              condition: path('firing/cleared, translated by the dictionary'),
              entity_id: path('The only correlation key with the alert chain'),
              title: path('One-line summary'),
              description: path('Full description'),
              labels,
              source_url: path('Link back to the signal in the origin'),
            },
            required: ['external_id', 'started_at', 'condition', 'entity_id'],
          },
          mappings: {
            type: 'object',
            properties: {
              condition: {
                additionalProperties: { type: 'string', enum: ['firing', 'cleared'] },
              },
              severity: {
                additionalProperties: { type: 'string', enum: ['1', '2', '3', '4', '5'] },
              },
            },
          },
        },
      },
    ],
  },
  deadlines: {
    type: 'object',
    properties: {
      deadlines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'integer' },
            seconds: { type: 'integer' },
          },
        },
      },
    },
  },
  targets: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severities: { type: 'array' },
            max_breaches: { type: 'integer' },
            achievement_pct: { type: 'number' },
          },
        },
      },
    },
  },
};
