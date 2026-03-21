# TypeScript Style Guide

## Tooling

- **Framework**: Nuxt 3 (Vue 3 + Composition API)
- **Linter**: ESLint with `@nuxt/eslint-config`
- **Formatter**: Prettier
- **Type checker**: `vue-tsc` (strict mode)

## General Rules

- Strict TypeScript (`strict: true` in tsconfig)
- Prefer `const` over `let`; never use `var`
- Use template literals over string concatenation
- Line length: 100 characters

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (components) | `PascalCase.vue` | `ConfigPanel.vue` |
| Files (composables) | `camelCase.ts` | `useScheduler.ts` |
| Files (utils) | `camelCase.ts` | `formatDate.ts` |
| Interfaces | `PascalCase` | `ScheduleConfig` |
| Types | `PascalCase` | `IncidentPriority` |
| Functions | `camelCase` | `fetchSchedules()` |
| Constants | `UPPER_SNAKE` | `API_BASE_URL` |
| Composables | `use` prefix | `useIncidents()` |

## Vue / Nuxt Conventions

- Use `<script setup lang="ts">` for all components
- Props defined with `defineProps<T>()` (type-based)
- Emits defined with `defineEmits<T>()`
- Prefer composables over mixins
- Keep components small and focused

## Type Safety

- No `any` — use `unknown` if type is truly unknown
- Define explicit interfaces for API responses and configs
- Use discriminated unions for state variants

```typescript
interface ScheduleConfig {
  cronExpression: string
  model: 'volume_forecast' | 'ola_breach'
  horizonDays: 1 | 7
  enabled: boolean
}
```

## Testing

- Framework: Vitest + Vue Test Utils
- Test files: `*.test.ts` or `*.spec.ts`
- Component tests focus on behavior, not implementation
