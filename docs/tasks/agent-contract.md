# Agent Metadata, Diagnostics and Validation Evidence

The six task APIs expose a shared `result.agent` envelope: `discoverGraph`,
`findAdjustmentSets`, `isAdjustmentSet`, `identifyEffect`, `falsifyGraph`, and
`stabilityAnalysis`. Existing result fields remain available, including
identification's `diagnostics` and `nextAction`. Direct discovery calls such as
`pc()` keep their existing return types.

All interfaces are available through `@kanaries/causal`, `@kanaries/causal/node`,
and `@kanaries/causal/web`. They require no Python, network access, or runtime
filesystem access. This design draws on StatsPAI's separation of method guidance,
diagnostic outcomes, and scoped validation evidence.

## Inspect Methods Before Running Them

```ts
import {
  describeAlgorithm,
  describeTask,
  getDiscoveryMethodMetadata,
  getIdentificationBackendDescriptor,
  listTaskMetadata,
  taskInputSchema
} from "@kanaries/causal";

const pc = describeAlgorithm("pc");
console.log(pc?.agent.preconditions);
console.log(pc?.agent.assumptions);
console.log(pc?.agent.notRecommendedWhen);
console.log(describeTask("identifyEffect"));
console.log(taskInputSchema("falsifyGraph"));
console.log(getDiscoveryMethodMetadata("anm"));
console.log(getIdentificationBackendDescriptor("dag-first-mvp")?.agent);
console.log(listTaskMetadata());
```

Metadata includes input schemas, assumptions, executable-input preconditions,
unsuitable use cases, failure modes with recovery hints, alternatives, cost, and
limitations. `apiStatus` describes the API lifecycle; it does not describe
validation coverage. Returned metadata is detached, so caller edits do not alter
the registry. Failure-mode codes are planning guidance, not a new exception-code
contract for existing algorithms.

Schemas describe the actual JavaScript interfaces. `NumericMatrix`, CI tests,
scores, and callbacks carry `x-js-type` and `x-json-serializable: false`
annotations. Callers must construct those runtime objects; these schemas are
not a JSON execution adapter or an MCP server. `anm` describes positional
arguments; task discovery describes an options object. CALM is marked planned
and unavailable because this repository has no implementation.

## Consume the Shared Result

```ts
import {
  CausalGraph, GRAPH_KIND, falsifyGraph, getDiagnosticSummary, identifyEffect
} from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["Z", "X", "Y"], { kind: GRAPH_KIND.dag });
graph.addDirectedEdge("Z", "X");
graph.addDirectedEdge("Z", "Y");
graph.addDirectedEdge("X", "Y");

const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
console.log(result.agent.diagnostics);
console.log(result.agent.degradations);
console.log(result.agent.nextActions);
console.log(result.agent.validation.outputs);
console.log(result.agent.provenance);

const structural = falsifyGraph({ graph: graph.toShape() });
console.log(structural.overallSummary.falsified); // null: no statistical decision
console.log(getDiagnosticSummary(structural.agent.diagnostics).allPassed); // false
```

The envelope has `schemaVersion: 1` and contains JSON-compatible values.
`provenance` records the effective configuration, backend, and known seed.
Defaults are recorded explicitly. Custom CI tests, scores, or callbacks are
identified conservatively; their code and hidden state are not serialized.
Provenance does not claim a data fingerprint, package version, or complete
reproducibility for custom implementations.

For stability analysis, discovery configuration comes from the options actually
rebuilt for the resampled runs. `baseDataRows`/`baseDataColumns` describe the
original matrix; `dataRows`/`dataColumns` describe the first executed discovery
matrix. `seed` is the resampling seed and `discoverySeed` is the first discovery
run's known seed. When recorded dimensions vary across runs,
`discoveryConfigurationScope` is `first-run`, a degradation makes that limit
explicit, and diagnostic details retain each run's configuration. Otherwise the
scope is `shared-recorded-dimensions`; this does not certify equality of opaque
callbacks or hidden state.

Each diagnostic has a stable code, status, severity, message, and optional
structured details:

| Status | Meaning |
| --- | --- |
| `passed` | The stated check completed and passed. |
| `failed` | The stated check completed and failed. |
| `inconclusive` | Available results cannot resolve the check. |
| `not_run` | The check has not been performed. |
| `not_applicable` | The check does not apply to this run. |

`getDiagnosticSummary().allPassed` requires at least one applicable check and
every applicable check to pass. Empty lists, only non-applicable checks,
inconclusive checks, and checks that did not run cannot imply success. Task
results explicitly include `causal_assumptions_not_checked`: structural or
statistical computation does not establish the underlying causal assumptions.

`degradations` records incomplete adjustment search, truncated payloads,
unavailable preferred graph artifacts, unsupported statistical checks, and
inconclusive CI tests where relevant. `nextActions` gives prioritized follow-up
guidance. A negative identification result means the selected backend's rules
did not identify the effect; it is not a general non-identifiability proof.

Falsification treats non-finite or out-of-range p-values as inconclusive. When
there are no conclusive CI tests, `overallSummary.falsified` is `null`. If some
tests are inconclusive, the Agent diagnostics retain that qualification even
when another test gives a conclusive result. Non-rejection does not confirm the
graph.

## Match Evidence to a Configuration and Output

```ts
import { getTaskValidationScope, listTaskValidationEvidence } from "@kanaries/causal";

const records = listTaskValidationEvidence("identifyEffect");
const coverage = getTaskValidationScope(
  "identifyEffect",
  result.agent.provenance.configuration,
  ["identifiable", "estimandSpec"]
);
console.log(records, coverage);
```

Evidence records name a method, configuration, outputs, evidence kind, test
artifact, and explicit scope. Configuration values are flat finite JSON scalars.
The matcher requires all recorded dimensions to be present, and their values to
match. Extra or different dimensions invalidate a match unless that evidence
record supplies an explicit invariance reason for those outputs. Missing
dimensions are unknown, never wildcards. `unmatchedEvidence` and
`uncheckedDimensions` explain failed matches.

The public pure function `assessValidationScope(request, records)` also accepts
caller-maintained evidence. It compares declarations; it does not inspect test
artifacts, run validation, or independently verify those records. Supplying
records there does not register them in the built-in manifest.

Per-output statuses distinguish `reference`, `analytical`, `regression`,
`stochastic`, and `not_covered`. Ordinary regression tests are behavioral evidence,
not numerical validation. Stochastic checks do not establish deterministic
reference agreement.

The aggregate status is `covered` only when every requested output has matching
reference or analytical evidence. Other outcomes are `partially_covered`,
`regression_only`, `stochastic_only`, and `not_covered`. A mixed set of regression
and stochastic evidence can be `partially_covered` without any analytical or
reference evidence: always inspect each output. An empty output request is
`not_covered`.

Coverage means that an existing test artifact exercises the declared
configuration and output within its stated fixture scope. It does not validate
the current dataset, prove causal assumptions, or certify all graphs using the
same options.

### Initial Built-in Evidence

The initial manifest contains five analytical records for the fully observed
three-node confounder DAG `Z → X`, `Z → Y`, `X → Y`:

- Full adjustment enumeration, with the hand-derived candidate `{Z}`.
- Validity checks for the empty candidate and `{Z}`.
- Both identification backends with default candidate limits, checking the
  returned backdoor expression against an independently enumerated binary SCM's
  intervention distribution.

These records live in `packages/tasks/src/validation-evidence.ts` and are
exercised by `packages/tasks/src/validation-evidence.test.ts`. Frontdoor,
zero-effect, other configurations, discovery, falsification, and stability do
not inherit those records. Existing unit suites and external parity reports are
not automatically promoted to configuration coverage. Artifact paths point to
repository tests; runtime evaluation never loads those files.

To extend coverage, add an independent analytical or reference test, record its
exact effective configuration and checked outputs, and assert that the runtime
configuration matches the evidence record. Document fixture limits and any
invariance claim. Keep behavior-only checks tagged `regression`.

## Compatibility

The new fields are additive for callers consuming results. Handwritten mocks
typed as task results or algorithm/backend descriptors must now supply the
required Agent fields; whole-object snapshots will include them.

These corrections accompany this contract: invalid count limits are rejected
instead of producing misleading configuration records; falsification with no
conclusive tests returns `null`; stability's `primaryGraphField` reports the
actual first-run artifact; and CALM availability reflects its missing
implementation. JavaScript callers can still use positive infinity for
`maxResults`, `maxSetSize`, or `maxAdjustmentSets`. Provenance records unbounded
return limits as `null` and records the effective finite maximum candidate size
after capping it to the eligible covariates.

See [the runnable example](../../examples/agent-metadata.ts) and the
[task result contract](result-contract.md).
