# Python Style Guide

## Tooling

- **Formatter**: `ruff format` (Black-compatible)
- **Linter**: `ruff check`
- **Type checker**: `pyright` or `mypy` (strict mode)
- **Package manager**: `uv`

## General Rules

- Python 3.12+ features encouraged (type hints, match statements, f-strings)
- Line length: 88 characters (ruff default)
- Imports sorted by `ruff` (isort-compatible)

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Modules | `snake_case` | `data_loader.py` |
| Classes | `PascalCase` | `IncidentPredictor` |
| Functions | `snake_case` | `load_incidents()` |
| Constants | `UPPER_SNAKE` | `MAX_RETRIES` |
| Variables | `snake_case` | `incident_count` |
| Private | `_leading_underscore` | `_parse_row()` |

## Type Hints

- Required for all function signatures (parameters and return types)
- Use `|` union syntax over `Union[]` (Python 3.12+)
- Use `collections.abc` types for generic collections

```python
def predict_volume(date: datetime, horizon: int = 7) -> list[float]:
    ...
```

## Docstrings

- Google style for public functions and classes
- Not required for obvious internal helpers

```python
def calculate_ola_breach_risk(incident: Incident) -> float:
    """Calculate the probability of OLA breach for an incident.

    Args:
        incident: The incident to evaluate.

    Returns:
        Breach probability between 0.0 and 1.0.
    """
```

## Data Science Specifics

- Prefer `pandas` method chaining over intermediate variables when readable
- Use descriptive column names (`snake_case`)
- Document data transformations with inline comments when non-obvious
- Keep notebooks for exploration; move production logic to `.py` modules

## Error Handling

- Use specific exceptions, not bare `except:`
- Let unexpected errors propagate — don't swallow them
- Validate data at ingestion boundaries, trust internal functions

## Testing

- Framework: `pytest`
- Test files: `test_<module>.py`
- Use fixtures for shared test data
- Data pipeline tests should use small representative samples
