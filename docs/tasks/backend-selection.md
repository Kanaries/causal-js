# Backend Selection

`identifyEffect()` exposes backend selection for the existing DAG witness
workflows and the experimental complete ID backend on observed DAGs/ADMGs.

## Available Backends

- `auto`: chooses `dag-first-mvp` for DAGs and the experimental `id` backend for ADMGs.
- `dag-first-mvp`: the broadest currently supported DAG-first backend. It evaluates zero-effect, backdoor, and core frontdoor witnesses.
- `dag-backdoor-only`: the conservative DAG-first backend. It evaluates zero-effect and backdoor only, and returns a structured non-identifiable result instead of attempting frontdoor.
- `id`: complete unconditional ID on observed DAGs/ADMGs, including bows. It returns an observational expression or a recursive non-identifiability witness.

`defaultForGraphKinds` identifies the exact graph kinds for which a descriptor
is selected by `auto`. `defaultForAuto` is true if that list is nonempty; more
than one backend can therefore have that boolean set.

## When To Prefer Each Backend

- Use `auto` when you want graph-dependent defaults: the established DAG witness
  workflow for DAGs and experimental complete ID for ADMGs.
- Use `dag-first-mvp` when you want to make frontdoor eligibility explicit and keep your code stable even if the future `auto` rule changes.
- Use `dag-backdoor-only` when you want a stricter production contract that refuses to cross into frontdoor logic and instead surfaces a scoped non-identifiable result.
- Use `id` for complete identification under an observed semi-Markovian DAG or
  ADMG. Every explicit node must be measured; encode latent common causes with
  bidirected edges. `maxAdjustmentSets` has no effect on this backend.

## Backend Choice Does Not Change

- backend selection does not resolve an equivalence class or compute a latent projection
- backend selection does not turn identification into estimation
- backend selection does not prove that a selected estimand is numerically well-conditioned

## When Not To Use This Guidance

- when you need PAG/MAG identification, conditional-effect IDC or counterfactual queries
- for multiple treatments/outcomes, use the lower-level `identifyById` set-valued interface
- when your release process cannot tolerate any backend defaulting and should always pin an explicit backend

## Operational Note

For production callers, prefer pinning `dag-first-mvp` or `dag-backdoor-only` explicitly in persisted pipelines. Keep `auto` for interactive workflows or places where following the library default is intentional.

The ID backend's API is currently marked experimental. Pin `id` explicitly when
adopting it in a persisted pipeline. Its negative result has a stronger meaning
than failure of the older witness rules: it is non-identifiability relative to
the supplied semi-Markovian graph. See [complete ID](id-identification.md) for
the AST, failure-witness semantics, support conditions and finite test coverage.
