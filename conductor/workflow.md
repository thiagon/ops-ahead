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
