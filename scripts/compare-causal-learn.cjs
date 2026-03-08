#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(ROOT, "fixtures", "causal-learn", "TestData");
const REPORT_PATH = path.join(ROOT, ".workspace", "causal-learn-comparison-report.json");

function loadPackages() {
  try {
    return {
      core: require(path.join(ROOT, "packages", "core", "dist", "index.cjs")),
      discovery: require(path.join(ROOT, "packages", "discovery", "dist", "index.cjs"))
    };
  } catch (error) {
    throw new Error(
      "Failed to load built workspace packages. Run `pnpm build` before `pnpm compare:causal-learn`.\n" +
        String(error instanceof Error ? error.message : error)
    );
  }
}

function loadTxtMatrix(filename, skipRows = 0) {
  const text = fs.readFileSync(path.join(FIXTURE_ROOT, filename), "utf8").trim();
  return text
    .split(/\n+/)
    .slice(skipRows)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

function centerColumns(rows) {
  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? 0;
  const means = Array.from({ length: columnCount }, (_, columnIndex) => {
    let total = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      total += rows[rowIndex]?.[columnIndex] ?? 0;
    }
    return total / rowCount;
  });

  return rows.map((row) =>
    row.map((value, columnIndex) => value - (means[columnIndex] ?? 0))
  );
}

function createNodeLabels(count) {
  return Array.from({ length: count }, (_, index) => `X${index + 1}`);
}

function graphOutputSummary(shape) {
  return {
    nodeCount: shape.nodes.length,
    edgeCount: shape.edges.length
  };
}

function endpointCode(endpoint) {
  switch (endpoint) {
    case "tail":
      return -1;
    case "arrow":
      return 1;
    case "circle":
      return 2;
    case "star":
      return 3;
    case "none":
      return 0;
    default:
      throw new Error(`Unsupported endpoint: ${endpoint}`);
  }
}

function graphMatrix(shape) {
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  for (const edge of shape.edges) {
    const index1 = nodeIndex.get(edge.node1);
    const index2 = nodeIndex.get(edge.node2);
    if (index1 === undefined || index2 === undefined) {
      throw new Error(`Missing node index for edge ${edge.node1}-${edge.node2}`);
    }

    matrix[index1][index2] = endpointCode(edge.endpoint1);
    matrix[index2][index1] = endpointCode(edge.endpoint2);
  }

  return matrix;
}

function graphNodes(shape) {
  return [...shape.nodes]
    .map((node) => ({
      id: node.id,
      nodeType: node.nodeType ?? "measured"
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function graphEdges(shape) {
  return [...shape.edges]
    .map((edge) => ({
      node1: edge.node1,
      node2: edge.node2,
      endpoint1: edge.endpoint1,
      endpoint2: edge.endpoint2
    }))
    .sort((left, right) => {
      return (
        left.node1.localeCompare(right.node1) ||
        left.node2.localeCompare(right.node2) ||
        left.endpoint1.localeCompare(right.endpoint1) ||
        left.endpoint2.localeCompare(right.endpoint2)
      );
    });
}

function normalizeClusters(clusters) {
  return clusters.map((cluster) => [...cluster].map(Number).sort((left, right) => left - right));
}

function adjacencyMatrixToJsonable(matrix) {
  return matrix.map((row) =>
    row.map((value) => (Number.isNaN(value) ? null : value))
  );
}

function makeCase(id, algorithm, input, output, result) {
  return { id, algorithm, input, output, result };
}

function runJsCases(core, discovery) {
  const {
    DenseMatrix,
    FisherZTest,
    ChiSquareTest,
    GSquareTest,
    GaussianBicScore,
    BDeuScore
  } = core;
  const { pc, cdnod, ges, exactSearch, grasp, gin, camuv, rcd } = discovery;

  const cases = [];

  const dataPcSim = new DenseMatrix(loadTxtMatrix("test_pc_simulated_linear_gaussian_data.txt", 1));
  const pcSim = pc({
    alpha: 0.05,
    ciTest: new FisherZTest(dataPcSim),
    data: dataPcSim,
    nodeLabels: createNodeLabels(dataPcSim.columns),
    stable: true,
    ucRule: 0,
    ucPriority: 2
  });
  cases.push(
    makeCase(
      "pc.simulated_gaussian.default",
      "pc",
      {
        data: { rows: dataPcSim.rows, columns: dataPcSim.columns },
        alpha: 0.05,
        ciTest: "fisherz",
        stable: true,
        ucRule: 0,
        ucPriority: 2
      },
      graphOutputSummary(pcSim.graph),
      { graphMatrix: graphMatrix(pcSim.graph) }
    )
  );

  const dataLinear10 = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
  for (const [ucRule, ucPriority] of [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, -1],
    [2, -1]
  ]) {
    const result = pc({
      alpha: 0.05,
      ciTest: new FisherZTest(dataLinear10),
      data: dataLinear10,
      nodeLabels: createNodeLabels(dataLinear10.columns),
      stable: true,
      ucRule,
      ucPriority
    });
    cases.push(
      makeCase(
        `pc.linear10.fisherz.${ucRule}.${ucPriority}`,
        "pc",
        {
          data: { rows: dataLinear10.rows, columns: dataLinear10.columns },
          alpha: 0.05,
          ciTest: "fisherz",
          stable: true,
          ucRule,
          ucPriority
        },
        graphOutputSummary(result.graph),
        { graphMatrix: graphMatrix(result.graph) }
      )
    );
  }

  const dataDiscrete10 = new DenseMatrix(loadTxtMatrix("data_discrete_10.txt", 1));
  for (const [name, TestClass] of [
    ["chisq", ChiSquareTest],
    ["gsq", GSquareTest]
  ]) {
    const result = pc({
      alpha: 0.05,
      ciTest: new TestClass(dataDiscrete10),
      data: dataDiscrete10,
      nodeLabels: createNodeLabels(dataDiscrete10.columns),
      stable: true,
      ucRule: 0,
      ucPriority: -1
    });
    cases.push(
      makeCase(
        `pc.discrete10.${name}.0.-1`,
        "pc",
        {
          data: { rows: dataDiscrete10.rows, columns: dataDiscrete10.columns },
          alpha: 0.05,
          ciTest: name,
          stable: true,
          ucRule: 0,
          ucPriority: -1
        },
        graphOutputSummary(result.graph),
        { graphMatrix: graphMatrix(result.graph) }
      )
    );
  }

  const domain1 = loadTxtMatrix("data_linear_1.txt", 1).slice(0, 100);
  const domain2 = loadTxtMatrix("data_linear_2.txt", 1).slice(0, 100);
  const domain3 = loadTxtMatrix("data_linear_3.txt", 1).slice(0, 100);
  const domainData = new DenseMatrix([...domain1, ...domain2, ...domain3]);
  const context = [
    ...Array.from({ length: domain1.length }, () => 1),
    ...Array.from({ length: domain2.length }, () => 2),
    ...Array.from({ length: domain3.length }, () => 3)
  ];
  const cdnodResult = cdnod({
    alpha: 0.05,
    data: domainData,
    context,
    createCiTest: (augmentedData) => new FisherZTest(augmentedData),
    nodeLabels: createNodeLabels(domainData.columns),
    stable: true,
    ucRule: 0,
    ucPriority: 2
  });
  cases.push(
    makeCase(
      "cdnod.domain123.fisherz.0.2",
      "cdnod",
      {
        data: { rows: domainData.rows, columns: domainData.columns },
        context: { rows: context.length, columns: 1 },
        alpha: 0.05,
        ciTest: "fisherz",
        stable: true,
        ucRule: 0,
        ucPriority: 2
      },
      graphOutputSummary(cdnodResult.graph),
      { graphMatrix: graphMatrix(cdnodResult.graph) }
    )
  );

  const gesLinear = ges({
    data: dataLinear10,
    score: new GaussianBicScore(dataLinear10),
    nodeLabels: createNodeLabels(dataLinear10.columns)
  });
  cases.push(
    makeCase(
      "ges.linear10.bic",
      "ges",
      {
        data: { rows: dataLinear10.rows, columns: dataLinear10.columns },
        score: "local_score_BIC",
        maxParents: null
      },
      graphOutputSummary(gesLinear.cpdag),
      { graphMatrix: graphMatrix(gesLinear.cpdag) }
    )
  );

  const dataGesSim = new DenseMatrix(loadTxtMatrix("test_ges_simulated_linear_gaussian_data.txt"));
  const gesSim = ges({
    data: dataGesSim,
    score: new GaussianBicScore(dataGesSim),
    nodeLabels: createNodeLabels(dataGesSim.columns)
  });
  cases.push(
    makeCase(
      "ges.simulated_gaussian.bic",
      "ges",
      {
        data: { rows: dataGesSim.rows, columns: dataGesSim.columns },
        score: "local_score_BIC",
        maxParents: null
      },
      graphOutputSummary(gesSim.cpdag),
      { graphMatrix: graphMatrix(gesSim.cpdag) }
    )
  );

  const gesDiscrete = ges({
    data: dataDiscrete10,
    score: new BDeuScore(dataDiscrete10),
    nodeLabels: createNodeLabels(dataDiscrete10.columns)
  });
  cases.push(
    makeCase(
      "ges.discrete10.bdeu",
      "ges",
      {
        data: { rows: dataDiscrete10.rows, columns: dataDiscrete10.columns },
        score: "local_score_BDeu",
        maxParents: null
      },
      graphOutputSummary(gesDiscrete.cpdag),
      { graphMatrix: graphMatrix(gesDiscrete.cpdag) }
    )
  );

  const exactRows = centerColumns(loadTxtMatrix("test_exact_search_simulated_linear_gaussian_data.txt"));
  const exactData = new DenseMatrix(exactRows);
  for (const [searchMethod, usePathExtension, useKCycleHeuristic] of [
    ["astar", true, true],
    ["dp", false, false]
  ]) {
    const result = exactSearch({
      data: exactData,
      score: new GaussianBicScore(exactData),
      nodeLabels: createNodeLabels(exactData.columns),
      searchMethod,
      usePathExtension,
      useKCycleHeuristic
    });
    cases.push(
      makeCase(
        `exactsearch.simulated_gaussian.${searchMethod}`,
        "exact-search",
        {
          data: { rows: exactData.rows, columns: exactData.columns },
          searchMethod,
          usePathExtension,
          useKCycleHeuristic,
          k: 3,
          centerColumns: true
        },
        graphOutputSummary(result.cpdag),
        { graphMatrix: graphMatrix(result.cpdag) }
      )
    );
  }

  const graspData = new DenseMatrix(loadTxtMatrix("test_grasp_seed123_data.txt"));
  const graspResult = grasp({
    data: graspData,
    score: new GaussianBicScore(graspData, { penaltyDiscount: 4 }),
    depth: 1,
    randomSeed: 123,
    nodeLabels: createNodeLabels(graspData.columns)
  });
  cases.push(
    makeCase(
      "grasp.seed123",
      "grasp",
      {
        data: { rows: graspData.rows, columns: graspData.columns },
        score: "local_score_BIC_from_cov",
        depth: 1,
        lambdaValue: 4,
        randomSeed: 123
      },
      graphOutputSummary(graspResult.cpdag),
      { graphMatrix: graphMatrix(graspResult.cpdag) }
    )
  );

  for (const caseIndex of [1, 2, 3]) {
    const ginData = new DenseMatrix(loadTxtMatrix(`test_gin_case${caseIndex}_data.txt`));
    for (const indepTestMethod of ["hsic", "kci"]) {
      const result = gin({
        data: ginData,
        alpha: 0.05,
        indepTestMethod,
        nodeLabels: createNodeLabels(ginData.columns)
      });
      cases.push(
        makeCase(
          `gin.case${caseIndex}.${indepTestMethod}`,
          "gin",
          {
            data: { rows: ginData.rows, columns: ginData.columns },
            indepTestMethod,
            alpha: 0.05
          },
          {
            nodeCount: result.graph.nodes.length,
            edgeCount: result.graph.edges.length,
            clusterCount: result.causalOrder.length
          },
          {
            causalOrder: normalizeClusters(result.causalOrder),
            graph: {
              nodes: graphNodes(result.graph),
              edges: graphEdges(result.graph)
            }
          }
        )
      );
    }
  }

  const camuvData = new DenseMatrix(loadTxtMatrix("test_camuv_seed42_data.txt"));
  const camuvResult = camuv({
    data: camuvData,
    alpha: 0.01,
    maxExplanatoryVars: 3,
    nodeLabels: createNodeLabels(camuvData.columns)
  });
  cases.push(
    makeCase(
      "camuv.seed42",
      "cam-uv",
      {
        data: { rows: camuvData.rows, columns: camuvData.columns },
        alpha: 0.01,
        maxExplanatoryVars: 3
      },
      {
        nodeCount: camuvData.columns,
        parentEntryCount: camuvResult.parents.filter((entry) => entry.length > 0).length,
        confoundedPairCount: camuvResult.confoundedPairs.length
      },
      {
        parents: normalizeClusters(camuvResult.parents),
        confoundedPairs: normalizeClusters(camuvResult.confoundedPairs)
      }
    )
  );

  const rcdData = new DenseMatrix(loadTxtMatrix("test_rcd_seed100_data.txt"));
  for (const bwMethod of ["mdbs", "scott", "silverman"]) {
    const rcdResult = rcd({
      data: rcdData,
      nodeLabels: createNodeLabels(rcdData.columns),
      maxExplanatoryNum: 2,
      corAlpha: 0.01,
      indAlpha: 0.01,
      shapiroAlpha: 0.01,
      mlhsicr: false,
      bwMethod
    });
    cases.push(
      makeCase(
        `rcd.seed100.${bwMethod}`,
        "rcd",
        {
          data: { rows: rcdData.rows, columns: rcdData.columns },
          maxExplanatoryNum: 2,
          corAlpha: 0.01,
          indAlpha: 0.01,
          shapiroAlpha: 0.01,
          mlhsicr: false,
          bwMethod
        },
        {
          nodeCount: rcdData.columns,
          parentEntryCount: rcdResult.parents.filter((entry) => entry.length > 0).length,
          confoundedPairCount: rcdResult.confoundedPairs.length
        },
        {
          parents: normalizeClusters(rcdResult.parents),
          ancestors: normalizeClusters(rcdResult.ancestors),
          confoundedPairs: normalizeClusters(rcdResult.confoundedPairs),
          adjacencyMatrix: adjacencyMatrixToJsonable(rcdResult.adjacencyMatrix)
        }
      )
    );
  }

  return cases;
}

function compareValues(left, right, pathParts = []) {
  const currentPath = pathParts.length === 0 ? "root" : pathParts.join(".");

  if (typeof left === "number" && typeof right === "number") {
    if (Number.isNaN(left) && Number.isNaN(right)) {
      return [];
    }
    if (Math.abs(left - right) <= 1e-6) {
      return [];
    }
    return [`${currentPath}: expected ${JSON.stringify(right)}, received ${JSON.stringify(left)}`];
  }

  if (left === right) {
    return [];
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const issues = [];
    if (left.length !== right.length) {
      issues.push(`${currentPath}: expected length ${right.length}, received ${left.length}`);
    }
    const sharedLength = Math.min(left.length, right.length);
    for (let index = 0; index < sharedLength; index += 1) {
      issues.push(...compareValues(left[index], right[index], [...pathParts, String(index)]));
    }
    return issues;
  }

  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const issues = [];
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join(",") !== rightKeys.join(",")) {
      issues.push(
        `${currentPath}: expected keys ${JSON.stringify(rightKeys)}, received ${JSON.stringify(leftKeys)}`
      );
    }
    const sharedKeys = [...new Set([...leftKeys, ...rightKeys])].sort();
    for (const key of sharedKeys) {
      if (!(key in left)) {
        issues.push(`${currentPath}.${key}: missing on JS side`);
        continue;
      }
      if (!(key in right)) {
        issues.push(`${currentPath}.${key}: unexpected key on JS side`);
        continue;
      }
      issues.push(...compareValues(left[key], right[key], [...pathParts, key]));
    }
    return issues;
  }

  return [`${currentPath}: expected ${JSON.stringify(right)}, received ${JSON.stringify(left)}`];
}

function runPythonReference() {
  const pythonScript = path.join(ROOT, "scripts", "python", "compare_causal_learn.py");
  const command = [
    "run",
    "--python",
    "/usr/local/bin/python3.10",
    "--with",
    "numpy",
    "--with",
    "pandas==1.5.3",
    "--with",
    "scipy",
    "--with",
    "scikit-learn",
    "--with",
    "pydot",
    "--with",
    "networkx",
    "--with",
    "graphviz",
    "--with",
    "momentchi2",
    "--with",
    "statsmodels",
    "--with",
    "pygam",
    "python",
    pythonScript
  ];
  const result = spawnSync("uv", command, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      CI: "1",
      PYTHONWARNINGS: "ignore",
      TQDM_DISABLE: "1"
    }
  });

  if (result.status !== 0) {
    throw new Error(
      `Python reference execution failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }

  return JSON.parse(result.stdout);
}

function main() {
  const { core, discovery } = loadPackages();
  const pythonPayload = runPythonReference();
  const jsPayload = {
    runtime: {
      nodeVersion: process.version
    },
    cases: runJsCases(core, discovery)
  };

  const pythonCases = new Map(pythonPayload.cases.map((entry) => [entry.id, entry]));
  const jsCases = new Map(jsPayload.cases.map((entry) => [entry.id, entry]));
  const caseIds = [...new Set([...pythonCases.keys(), ...jsCases.keys()])].sort();
  const mismatches = [];
  const comparisons = [];

  for (const caseId of caseIds) {
    const pythonCase = pythonCases.get(caseId);
    const jsCase = jsCases.get(caseId);

    if (!pythonCase || !jsCase) {
      mismatches.push({
        id: caseId,
        issues: [pythonCase ? "Missing JS case." : "Missing Python case."]
      });
      continue;
    }

    const issues = [
      ...compareValues(jsCase.algorithm, pythonCase.algorithm, [caseId, "algorithm"]),
      ...compareValues(jsCase.input, pythonCase.input, [caseId, "input"]),
      ...compareValues(jsCase.output, pythonCase.output, [caseId, "output"]),
      ...compareValues(jsCase.result, pythonCase.result, [caseId, "result"])
    ];

    comparisons.push({
      id: caseId,
      algorithm: jsCase.algorithm,
      matched: issues.length === 0
    });

    if (issues.length > 0) {
      mismatches.push({
        id: caseId,
        algorithm: jsCase.algorithm,
        issues
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pythonRuntime: pythonPayload.runtime,
    jsRuntime: jsPayload.runtime,
    totals: {
      pythonCases: pythonPayload.cases.length,
      jsCases: jsPayload.cases.length,
      comparedCases: caseIds.length,
      mismatches: mismatches.length
    },
    comparisons,
    mismatches
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (mismatches.length > 0) {
    console.error(`Found ${mismatches.length} mismatched case(s). Report: ${REPORT_PATH}`);
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch.id}`);
      for (const issue of mismatch.issues.slice(0, 10)) {
        console.error(`  * ${issue}`);
      }
      if (mismatch.issues.length > 10) {
        console.error(`  * ... ${mismatch.issues.length - 10} more`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Compared ${caseIds.length} case(s) against causal-learn successfully. Report: ${REPORT_PATH}`
  );
}

main();
