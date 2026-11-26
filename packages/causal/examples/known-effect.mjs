import {
  BackgroundKnowledge, DenseMatrix, FisherZTest, findAdjustmentSets,
  identifyEffect, pc, resolveDagForTasks
} from "@kanaries/causal";
import { estimateEffect } from "@kanaries/causal/node";

// Seeded normal errors make the same sample available to every step.
let state = 1987;
function uniform() {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return (state + 0.5) / 2 ** 32;
}
function normal() {
  return Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

const columns = ["Z", "X", "Y"];
const knownEffect = 0.6;
const rows = Array.from({ length: 1200 }, () => {
  const z = normal();
  const x = 0.8 * z + normal();
  const y = knownEffect * x + 0.9 * z + normal();
  return [z, x, y];
});

const data = new DenseMatrix(rows);
const options = { data, nodeLabels: columns, ciTest: new FisherZTest(data) };
const observational = pc(options).graph;

// Z is measured before treatment X, and Y after treatment. Supply that
// temporal knowledge to PC while retaining the skeleton learned from data.
const order = new BackgroundKnowledge().addNodeToTier("Z", 0)
  .addNodeToTier("X", 1).addNodeToTier("Y", 2);
const oriented = pc({ ...options, backgroundKnowledge: order }).graph;
const { dag } = resolveDagForTasks(oriented);
const query = { graph: dag, treatment: "X", outcome: "Y" };
const identified = identifyEffect(query);
const { canonicalSet } = findAdjustmentSets(query);
if (identified.method !== "backdoor" || !canonicalSet?.length) {
  throw new Error("The simulated graph did not yield the expected backdoor adjustment.");
}

// The simulation has an additive constant effect and linear nuisance models.
const fit = await estimateEffect({
  method: "dml-plr", treatment: "X", outcome: "Y", covariates: canonicalSet,
  data: { columns, rows }, seed: 0
}, { pythonExecutable: process.env.CAUSAL_JS_PYTHON });

console.log(JSON.stringify({
  observationalEdges: observational.edges, orientedEdges: dag.edges,
  adjustmentSet: canonicalSet, identification: identified.method,
  knownEffect, estimate: fit.estimate, confidenceInterval: fit.confidenceInterval
}, null, 2));
