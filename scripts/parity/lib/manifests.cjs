const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const PARITY_ROOT = path.join(ROOT, "parity");

function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function loadParityJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(PARITY_ROOT, filename), "utf8"));
}

function loadManifests() {
  const algorithms = loadParityJson("algorithms.manifest.json");
  const primitives = loadParityJson("primitives.manifest.json");
  const fixtures = loadParityJson("fixtures.manifest.json");
  const cases = loadParityJson("cases.manifest.json");

  return {
    root: ROOT,
    parityRoot: PARITY_ROOT,
    algorithms,
    primitives,
    fixtures,
    cases,
    algorithmById: new Map(algorithms.algorithms.map((entry) => [entry.id, entry])),
    primitiveById: new Map(primitives.primitives.map((entry) => [entry.id, entry])),
    fixtureById: new Map(fixtures.fixtures.map((entry) => [entry.id, entry])),
    caseById: new Map(cases.cases.map((entry) => [entry.id, entry]))
  };
}

module.exports = {
  ROOT,
  PARITY_ROOT,
  loadJson,
  loadManifests
};
