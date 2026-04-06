# Backend Selection

`identifyEffect()` exposes backend selection because the current production-scope DAG-first workflow deliberately supports more than one identification contract.

## Available Backends

- `auto`: default selection rule. In the current production-scope DAG-first release, `auto` resolves to `dag-first-mvp`.
- `dag-first-mvp`: the broadest currently supported DAG-first backend. It evaluates zero-effect, backdoor, and core frontdoor witnesses.
- `dag-backdoor-only`: the conservative DAG-first backend. It evaluates zero-effect and backdoor only, and returns a structured non-identifiable result instead of attempting frontdoor.

## When To Prefer Each Backend

- Use `auto` when you want the default production-scope DAG-first behavior and are comfortable following the library's current default backend contract.
- Use `dag-first-mvp` when you want to make frontdoor eligibility explicit and keep your code stable even if the future `auto` rule changes.
- Use `dag-backdoor-only` when you want a stricter production contract that refuses to cross into frontdoor logic and instead surfaces a scoped non-identifiable result.

## Backend Choice Does Not Change

- backend selection does not upgrade the graph class; this layer is still DAG-first
- backend selection does not turn identification into estimation
- backend selection does not prove that a selected estimand is numerically well-conditioned

## When Not To Use This Guidance

- when you need full ID across richer graph classes
- when you need multi-treatment, conditional interventional, or counterfactual queries
- when your release process cannot tolerate any backend defaulting and should always pin an explicit backend

## Operational Note

For production callers, prefer pinning `dag-first-mvp` or `dag-backdoor-only` explicitly in persisted pipelines. Keep `auto` for interactive workflows or places where following the library default is intentional.
