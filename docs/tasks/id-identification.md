# Complete ID and ADMG Bows

`identifyEffect()` now includes the `id` backend. It implements unconditional
intervention-distribution identification on observed DAGs and acyclic directed
mixed graphs (ADMGs). The lower-level `identifyById()` accepts disjoint sets of
treatment and outcome nodes, including an empty treatment set.

The new backend is marked `experimental` in Agent metadata. Its implementation
is complete ID, rather than a list of adjustment/frontdoor shortcuts; that
algorithmic scope does not claim universal implementation validation or validate
the user's causal graph.
Inspect its lifecycle through
`getIdentificationBackendDescriptor("id").agent.apiStatus`; the shared task
interface's lifecycle is separate from that of this backend.

## Use the Existing Task Interface

```ts
import { CausalGraph, GRAPH_KIND, identifyEffect } from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["X", "M", "Y"], { kind: GRAPH_KIND.admg });
graph.addDirectedEdge("X", "M");
graph.addDirectedEdge("M", "Y");
graph.addBidirectedEdge("X", "Y");

const result = identifyEffect({
  graph: graph.toShape(), treatment: "X", outcome: "Y", backend: "id"
});
console.log(result.identifiable); // true: a frontdoor model
console.log(result.estimandSpec?.expressionTree);
console.log(result.witness.id?.trace);
console.log(result.agent.validation);
```

`auto` keeps `dag-first-mvp` for DAGs and selects `id` for ADMGs. Explicit `id`
also accepts observed DAGs. `identifyEffect` keeps its singleton string query
contract and existing result fields. A successful ID result has `method: "id"`
and `estimandSpec.strategy: "id"`; it does not relabel ID's output as a backdoor
or frontdoor witness. `maxAdjustmentSets` is a DAG witness-backend option and
does not truncate ID. It still undergoes the shared count-limit input validation;
a valid supplied value produces a `not_applicable` diagnostic.

For joint queries, call the portable lower-level engine:

```ts
import { identifyById } from "@kanaries/causal";

const joint = identifyById({
  graph: graph.toShape(), treatment: ["X"], outcome: ["M", "Y"]
});
if (joint.identified) console.log(joint.expressionTree);
else console.log(joint.idFailureWitness);
```

Both interfaces are available in the root, Node, and Web facades, in ESM and
CommonJS. No Python, network service, or external symbolic engine is required.

## Represent and Inspect Bows

A bow consists of both `X → Y` and `X ↔ Y`. It must preserve the directed effect
and latent confounding as separate edges:

```ts
const bow = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
bow.addDirectedEdge("X", "Y", { source: "direct" });
bow.addBidirectedEdge("X", "Y", { source: "latent" });
console.log(bow.getEdgesBetween("X", "Y")); // two edges
console.log(bow.getDirectedEdge("X", "Y"));
console.log(bow.getBidirectedEdge("X", "Y"));
console.log(bow.getDistricts()); // [["X", "Y"]]
```

Insertion order does not change the two-edge result. `toShape`, `serialize`,
`fromShape`, `deserialize`, `clone`, and `inducedSubgraph` preserve both edges
and their independent metadata. The JSON representation keeps version 1 and
uses two edge descriptors with the same pair and different endpoint patterns.
Consumers must inspect `kind: "admg"` and retain both descriptors.

Single-edge methods `getEdge`, `getEndpoint`, and `getEdgeMetadata` require the
optional `"directed"` or `"bidirected"` argument on a bow. Without it, they throw
an ambiguity error. `setEdgeMetadata(a, b, metadata, edgeType)` selects the
appropriate layer. `removeDirectedEdge` and `removeBidirectedEdge` remove one
layer; `getDirectedEdge(from, to)` and `removeDirectedEdge(from, to)` respect the
arrow's direction. `removeEdge` removes the whole pair. Parent, child, ancestor and
topological-order queries use the directed layer. Districts use bidirected
connectivity.

`getAdmgAdjacencyMatrices()` returns separate directed and bidirected 0/1
matrices in graph node order. Legacy single-endpoint matrix and legacy-shape
exports reject bows, as do conversions that would discard one layer. Non-ADMG
edge-update semantics remain unchanged. Serialized duplicate pairs are rejected
unless they are an ADMG's one directed plus one bidirected edge. Adding a
directed cycle to an ADMG is rejected and rolls back the attempted edge update.

## Symbolic Expression Contract

The AST extends the existing `constant`, `probability`, `product`, and `sum`
union with:

```ts
{ type: "quotient", numerator: IdentificationExpressionNode,
  denominator: IdentificationExpressionNode }
```

`quotientNode`, `cloneExpressionTree`, `getFreeVariables`, and
`collectSummationVariables` are public helpers. Constructors copy their inputs.
Empty products and probabilities of empty events represent one; a sum over no
variables returns its integrand.

Each `sum` binds its identifiers only inside its own expression. A variable can
be bound in one subtree and free in another. The ID backend uses exact graph
identifiers; apostrophes in those identifiers do not denote aliases for other
variables. Numerical consumers should traverse the AST using local assignment environments rather
than replacing names globally or parsing the display string.
`collectSummationVariables` is an inventory of binder names, not a list to
eliminate globally; `getFreeVariables` respects each binder's local scope.

ID factors the **current recursive kernel** using ratios of prefix marginals.
Those expressions cannot generally be replaced with conditional probabilities
from the original joint law after a recursive graph reduction. Quotients are
preserved without cancellation that could conceal zero denominators. Display
rendering groups nested sums, products and quotients; it is not a parser format.

## Algorithm and Failure Semantics

The implementation follows the seven-step ID algorithm in
[Shpitser and Pearl (2006), Figure 3](https://ftp.cs.ucla.edu/pub/stat_ser/r327.pdf):
empty-intervention marginalization, ancestor restriction, intervention expansion,
district decomposition, the non-identifiability criterion, extraction of an
existing district kernel, and recursion into a containing district.

After step 3, added intervention variables are averaged against their normalized
observational marginal. The step's intervention-invariance justifies this
normalization on positive support and removes non-query free variables from the
output. This output normalization is documented in the trace and source.

`witness.id.trace` records each recursive step, its node sets, and the selected
district or reduction. When ID fails, `identifiable` is false, the estimand
fields are null, and `witness.id.failure` contains the graph and district of the
step-5 subproblem. The low-level engine exposes the same object as
`idFailureWitness`. These subgraphs contain the obstruction; they are explicitly
**not labeled as an extracted pair of C-forests**.

For `id`, failure is a non-identifiability conclusion within the supplied
semi-Markovian model. Agent diagnostic `identification_id` is `failed`, not
`inconclusive`, and an expected negative answer is not a degradation. Older DAG
witness backends retain their scoped meaning: failure of their limited rules
does not establish global non-identifiability.

## Input and Statistical Boundaries

- Every explicit ID node must be measured. Represent latent common causes with
  bidirected ADMG edges; simply deleting latent DAG nodes is not a latent
  projection. Automatic latent projection is not implemented.
- The directed part must be acyclic. PAGs, CPDAGs, circles and undirected edges
  are rejected. Directed generic shapes remain accepted as DAGs; mixed graphs
  must explicitly declare `admg`.
- Treatment/outcome IDs must exist, be distinct within each set and disjoint
  across sets. The low-level outcome set must be nonempty.
- This is unconditional joint-distribution ID. Conditional-effect IDC,
  counterfactual identification, selection/transport diagrams, and effect
  estimation are outside this implementation.
- Evaluating a formula requires support for its conditionals and nonzero
  denominators. No positivity check or estimator runs here. The numerical
  validation models use strictly positive observational laws.

## Validation and Evidence

Validation includes independent finite binary SCM enumeration, comparing the
returned observational functional with the distribution computed directly after
intervening on structural equations. It covers frontdoor, multiple districts,
multiple treatments and outcomes, recursive kernels, real apostrophe-containing
identifiers, and the original paper's five-node positive/negative examples.

All 64 three-node ADMGs with a fixed directed order are tested over their 384
singleton queries. Successful formulas are checked on two positive SCM tables.
An independent exhaustive C-forest/hedge oracle verifies every identification
decision for these singleton queries, including failures. An additional audit
checks 80 four/five-node graphs, 240 queries and 788 intervention/outcome
assignments for the 119 identified cases. Positive bow countermodels share the
same observed distribution and differ under intervention.

These are finite validation scopes, not an exhaustive test of every ADMG. The
P0 evidence manifest adds three analytical records for explicit ID on a DAG
confounder, ADMG frontdoor, and a non-identifiable bow. Each matches the runtime
configuration and the `identifiable`/`estimandSpec` outputs. Trace and witness
outputs are not automatically certified by those records. See the
[Agent contract](agent-contract.md) for evidence matching rules.

See [the typed example](../../examples/id-identification.ts) and
[backend selection](backend-selection.md).
