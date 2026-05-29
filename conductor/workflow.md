# Workflow

## TDD Policy

**Moderate** — Tests are encouraged and written alongside implementation. Not blocking, but expected for all non-trivial logic (ML pipelines, data transformations, scheduling).

## Commit Strategy

**Conventional Commits** — All commits follow the structured format:

- `feat:` — New features or capabilities
- `fix:` — Bug fixes
- `chore:` — Maintenance, dependencies, config
- `docs:` — Documentation changes
- `test:` — Test additions or modifications
- `refactor:` — Code restructuring without behavior change
- `data:` — Dataset or data pipeline changes

## Code Review

**Required for all changes** — Every change needs review before merge, regardless of size.

## Verification Checkpoints

**At track completion only** — Manual verification is required when an entire track is done. Individual tasks and phases proceed without blocking on manual review.

## Task Lifecycle

1. **Created** — Task defined with clear acceptance criteria
2. **In Progress** — Active development
3. **Testing** — Tests written and passing
4. **Review** — Code review requested
5. **Complete** — Merged and verified

## Branch Strategy

- Feature branches from `main`
- Branch naming: `track/<track-id>/<short-description>`
- Merge via PR with required review

## Commit Strategy per Track

One commit per completed phase — only after the phase verification passes. Never commit a phase with failing checks.

Commit format follows Conventional Commits with the track scope:
```
<type>(infra|data|ml|agent|ui): <phase summary>

Examples:
chore(infra): add ns:data helm charts (kafka, minio, clickhouse, argo)
feat(ml): train and register volume forecasting model in mlflow
feat(agent): implement agent graph with 3 initial tools
```

## GitHub Integration

Every track created with `/conductor:new-track` must:

1. **Criar um GitHub Issue** via `gh issue create` com:
   - Title: título em linguagem natural e simples, descrevendo o que será feito (ex: "Configurar infraestrutura base no Kubernetes"). Sem colchetes, sem track-id no título.
   - Body: conteúdo do `spec.md` gerado. Incluir no início do body a linha `track: <track-id>` para rastreabilidade.
   - Label: `type:dev` para Feature, `type:research` para Chore de análise, `chore` para infra/config
   - Milestone: conforme a sprint em que a track será entregue (ver tabela abaixo)

2. **Adicionar ao GitHub Project** `PVT_kwHOAMTXF84BXZ25` ("Ops Ahead"):
   ```bash
   gh project item-add 1 --owner thiagon --url <issue-url>
   ```

3. **Salvar o número do issue** em `conductor/tracks/<trackId>/metadata.json` no campo `github_issue`.

### Milestones

| Sprint | Milestone número | Due date |
|--------|-----------------|----------|
| Sprint 2 — Arquitetura | `2` | 2026-05-24 |
| Sprint 3 — MVP | `3` | 2026-08-23 |
| Sprint 4 — Solução Final | `4` | 2026-09-08 |

### Perguntas obrigatórias ao criar a track

Após gerar a spec e antes de criar os arquivos, perguntar:

**Sprint de entrega:**
```
Em qual sprint esta track será entregue?
1. Sprint 3 — MVP (milestone #3, entrega 23/08/2026)
2. Sprint 4 — Solução Final (milestone #4, entrega 08/09/2026)
```

Criar o issue com milestone via API (o flag `--milestone` do `gh issue create` usa o título, não o número):
```bash
gh issue create \
  --title "<título em linguagem natural>" \
  --body-file conductor/tracks/<trackId>/spec.md \
  --label "type:dev"

gh api repos/thiagon/ops-ahead/issues/<number> \
  --method PATCH --field milestone=<número>

gh project item-add 1 --owner thiagon \
  --url https://github.com/thiagon/ops-ahead/issues/<number>
```

### Branch e Draft PR — etapa obrigatória após criar a track

Imediatamente após criar os arquivos da track, criar a branch e abrir um Draft PR.

Branch naming segue a convenção do projeto: `feat/<slug>` para features e chores, `docs/<slug>` para tracks de documentação.

```bash
git checkout -b feat/<slug>
git push -u origin feat/<slug>

gh pr create --draft \
  --title "<título em linguagem natural>" \
  --body "closes #<issue-number>

## Track
- ID: <track-id>
- Spec: conductor/tracks/<trackId>/spec.md
- Plan: conductor/tracks/<trackId>/plan.md" \
  --milestone <número>
```

Salvar o número do PR em `metadata.json` no campo `github_pr`.

### Fluxo completo de uma track

```
/conductor:new-track
  → spec.md + plan.md + metadata.json + index.md
  → gh issue create  (linkado ao milestone + project)
  → git checkout -b feat/<slug>
  → gh pr create --draft  (closes #<issue>)

/conductor:implement <track-id>
  → fase 1 implementada + verificação passou → commit
  → fase 2 implementada + verificação passou → commit
  → ...
  → final verification passou

gh pr ready  (Draft → Ready for Review)
  → review + merge → issue fecha automaticamente
```
