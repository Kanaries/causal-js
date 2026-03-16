const { performance } = require("node:perf_hooks");

const {
  loadPackages,
  createNodeLabels,
  createOracleData,
  buildBackgroundKnowledge,
  createDag,
  graphMatrix,
  graphNodes,
  graphEdges,
  graphOutputSummary,
  normalizeClusters,
  adjacencyMatrixToJsonable,
  fisherZStats,
  discreteCiStats,
  loadFixturePayload
} = require("./common.cjs");

function createCiTest(core, data, testId, oracleDagFixture) {
  if (testId === "fisher-z") {
    return new core.FisherZTest(data);
  }
  if (testId === "chi-square") {
    return new core.ChiSquareTest(data);
  }
  if (testId === "g-square") {
    return new core.GSquareTest(data);
  }
  if (testId === "d-separation") {
    if (!oracleDagFixture) {
      throw new Error("D-separation requires an oracle DAG fixture.");
    }
    const dag = createDag(core.CausalGraph, oracleDagFixture.totalNodes, oracleDagFixture.edges);
    return new core.DSeparationTest(dag, createNodeLabels(oracleDagFixture.observedCount));
  }
  throw new Error(`Unsupported CI test: ${testId}`);
}

function createScore(core, data, scoreId, options) {
  if (scoreId === "gaussian-bic-score") {
    return new core.GaussianBicScore(data, {
      penaltyDiscount: options?.lambdaValue
    });
  }
  if (scoreId === "bdeu-score") {
    return new core.BDeuScore(data, {
      samplePrior: options?.samplePrior,
      structurePrior: options?.structurePrior
    });
  }
  throw new Error(`Unsupported score: ${scoreId}`);
}

function runCiCase(core, fixturePayload, execution) {
  const rows = fixturePayload.dataRows;
  const data = new core.DenseMatrix(rows);
  let result;
  if (execution.testId === "fisher-z") {
    result = fisherZStats(rows, execution.x, execution.y, execution.conditioningSet);
  } else {
    result = discreteCiStats(
      rows,
      execution.x,
      execution.y,
      execution.conditioningSet,
      execution.testId === "g-square"
    );
  }

  const ciTest = createCiTest(core, data, execution.testId);
  const pValue = ciTest.test(execution.x, execution.y, execution.conditioningSet);

  return {
    input: {
      data: { rows: data.rows, columns: data.columns },
      x: execution.x,
      y: execution.y,
      conditioningSet: execution.conditioningSet
    },
    output: {
      metricKind: "ci-test"
    },
    result: {
      pValue,
      statistic: result.statistic,
      degreesOfFreedom: result.degreesOfFreedom
    }
  };
}

function runScoreCase(core, fixturePayload, execution) {
  const data = new core.DenseMatrix(fixturePayload.dataRows);
  const score = createScore(core, data, execution.scoreId, execution.parameters);

  return {
    input: {
      data: { rows: data.rows, columns: data.columns },
      node: execution.node,
      parents: execution.parents,
      parameters: execution.parameters ?? null
    },
    output: {
      metricKind: "score"
    },
    result: {
      score: score.score(execution.node, execution.parents)
    }
  };
}

function runGraphAlgorithmCase(core, discovery, fixturePayload, fixtureDefinition, execution) {
  const { algorithmId, options } = execution;
  const hasOracleDag = fixtureDefinition.kind === "oracle-dag";
  const data = hasOracleDag
    ? createOracleData(core.DenseMatrix, fixtureDefinition.observedCount)
    : new core.DenseMatrix(fixturePayload.dataRows);
  const nodeLabels = createNodeLabels(data.columns);
  const backgroundKnowledge = buildBackgroundKnowledge(
    core.BackgroundKnowledge,
    options.backgroundKnowledge
  );

  if (algorithmId === "pc") {
    const result = discovery.pc({
      alpha: options.alpha,
      ciTest: createCiTest(core, data, options.ciTest),
      data,
      nodeLabels,
      stable: options.stable,
      ucRule: options.ucRule,
      ucPriority: options.ucPriority
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        alpha: options.alpha,
        ciTest: options.ciTest,
        stable: options.stable,
        ucRule: options.ucRule,
        ucPriority: options.ucPriority
      },
      output: graphOutputSummary(result.graph),
      result: {
        graphMatrix: graphMatrix(result.graph)
      }
    };
  }

  if (algorithmId === "cdnod") {
    const result = discovery.cdnod({
      alpha: options.alpha,
      data,
      context: fixturePayload.context,
      nodeLabels,
      createCiTest: (augmentedData) => createCiTest(core, augmentedData, options.ciTest),
      stable: options.stable,
      ucRule: options.ucRule,
      ucPriority: options.ucPriority
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        context: { rows: fixturePayload.context.length, columns: 1 },
        alpha: options.alpha,
        ciTest: options.ciTest,
        stable: options.stable,
        ucRule: options.ucRule,
        ucPriority: options.ucPriority
      },
      output: graphOutputSummary(result.graph),
      result: {
        graphMatrix: graphMatrix(result.graph)
      }
    };
  }

  if (algorithmId === "fci") {
    const result = discovery.fci({
      alpha: options.alpha,
      ciTest: createCiTest(core, data, options.ciTest, fixtureDefinition),
      data,
      nodeLabels,
      ...(backgroundKnowledge ? { backgroundKnowledge } : {})
    });
    return {
      input: {
        ...(hasOracleDag
          ? {
              observedCount: fixtureDefinition.observedCount,
              totalNodes: fixtureDefinition.totalNodes
            }
          : {
              data: { rows: data.rows, columns: data.columns }
            }),
        alpha: options.alpha,
        ciTest: options.ciTest,
        ...(options.backgroundKnowledge ? { backgroundKnowledge: options.backgroundKnowledge } : {})
      },
      output: graphOutputSummary(result.graph),
      result: {
        graphMatrix: graphMatrix(result.graph)
      }
    };
  }

  if (algorithmId === "ges") {
    const result = discovery.ges({
      data,
      score: createScore(core, data, options.score, { lambdaValue: options.lambdaValue }),
      nodeLabels
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        score: options.score
      },
      output: graphOutputSummary(result.cpdag),
      result: {
        graphMatrix: graphMatrix(result.cpdag)
      }
    };
  }

  if (algorithmId === "exact-search") {
    const result = discovery.exactSearch({
      data,
      score: createScore(core, data, options.score, { lambdaValue: options.lambdaValue }),
      searchMethod: options.searchMethod,
      usePathExtension: options.usePathExtension,
      useKCycleHeuristic: options.useKCycleHeuristic,
      nodeLabels
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        score: options.score,
        searchMethod: options.searchMethod,
        usePathExtension: options.usePathExtension,
        useKCycleHeuristic: options.useKCycleHeuristic
      },
      output: graphOutputSummary(result.cpdag),
      result: {
        graphMatrix: graphMatrix(result.cpdag)
      }
    };
  }

  if (algorithmId === "grasp") {
    const runSingle = (seed) => {
      const result = discovery.grasp({
        data,
        score: createScore(core, data, options.score, { lambdaValue: options.lambdaValue }),
        depth: options.depth,
        randomSeed: seed
      });
      return {
        seed,
        graphMatrix: graphMatrix(result.cpdag)
      };
    };

    if (Array.isArray(options.randomSeeds)) {
      return {
        input: {
          data: { rows: data.rows, columns: data.columns },
          score: options.score,
          lambdaValue: options.lambdaValue ?? null,
          depth: options.depth,
          randomSeeds: options.randomSeeds
        },
        output: {
          runCount: options.randomSeeds.length,
          nodeCount: data.columns
        },
        result: {
          runs: options.randomSeeds.map((seed) => runSingle(seed))
        }
      };
    }

    const result = runSingle(options.randomSeed);
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        score: options.score,
        lambdaValue: options.lambdaValue ?? null,
        depth: options.depth,
        randomSeed: options.randomSeed
      },
      output: {
        nodeCount: data.columns
      },
      result
    };
  }

  throw new Error(`Unsupported graph algorithm: ${algorithmId}`);
}

function runStructuredAlgorithmCase(core, discovery, fixturePayload, execution) {
  const data = new core.DenseMatrix(fixturePayload.dataRows);

  if (execution.algorithmId === "gin") {
    const result = discovery.gin({
      data,
      indepTestMethod: execution.options.indepTestMethod,
      alpha: execution.options.alpha
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        indepTestMethod: execution.options.indepTestMethod,
        alpha: execution.options.alpha
      },
      output: {
        nodeCount: result.graph.nodes.length,
        edgeCount: result.graph.edges.length,
        clusterCount: result.causalOrder.length
      },
      result: {
        causalOrder: normalizeClusters(result.causalOrder),
        graph: {
          nodes: graphNodes(result.graph),
          edges: graphEdges(result.graph)
        }
      }
    };
  }

  if (execution.algorithmId === "cam-uv") {
    const result = discovery.camuv({
      data,
      alpha: execution.options.alpha,
      maxExplanatoryVars: execution.options.maxExplanatoryVars
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        alpha: execution.options.alpha,
        maxExplanatoryVars: execution.options.maxExplanatoryVars
      },
      output: {
        nodeCount: data.columns,
        parentEntryCount: result.parents.filter((entry) => entry.length > 0).length,
        confoundedPairCount: result.confoundedPairs.length
      },
      result: {
        parents: normalizeClusters(result.parents),
        confoundedPairs: normalizeClusters(result.confoundedPairs)
      }
    };
  }

  if (execution.algorithmId === "rcd") {
    const result = discovery.rcd({
      data,
      maxExplanatoryNum: execution.options.maxExplanatoryNum,
      corAlpha: execution.options.corAlpha,
      indAlpha: execution.options.indAlpha,
      shapiroAlpha: execution.options.shapiroAlpha,
      mlhsicr: execution.options.mlhsicr,
      bwMethod: execution.options.bwMethod
    });
    return {
      input: {
        data: { rows: data.rows, columns: data.columns },
        maxExplanatoryNum: execution.options.maxExplanatoryNum,
        corAlpha: execution.options.corAlpha,
        indAlpha: execution.options.indAlpha,
        shapiroAlpha: execution.options.shapiroAlpha,
        mlhsicr: execution.options.mlhsicr,
        bwMethod: execution.options.bwMethod
      },
      output: {
        nodeCount: data.columns,
        parentEntryCount: result.parents.filter((entry) => entry.length > 0).length,
        confoundedPairCount: result.confoundedPairs.length
      },
      result: {
        parents: normalizeClusters(result.parents),
        ancestors: normalizeClusters(result.ancestors),
        confoundedPairs: normalizeClusters(result.confoundedPairs),
        adjacencyMatrix: adjacencyMatrixToJsonable(result.adjacencyMatrix)
      }
    };
  }

  throw new Error(`Unsupported structured algorithm: ${execution.algorithmId}`);
}

function selectComponentId(caseDefinition) {
  return caseDefinition.componentId;
}

function runJsCases(manifests, caseDefinitions, options = {}) {
  const packages = loadPackages(manifests.root);
  const { core, discovery } = packages;

  return caseDefinitions.map((caseDefinition) => {
    const startedAt = performance.now();
    const fixtureDefinition = manifests.fixtureById.get(caseDefinition.fixtureId);
    if (!fixtureDefinition) {
      throw new Error(`Unknown fixture: ${caseDefinition.fixtureId}`);
    }
    const fixturePayload = loadFixturePayload(
      manifests.root,
      options.oracleRoot,
      fixtureDefinition
    );

    let payload;
    if (caseDefinition.execution.kind === "ci-test") {
      payload = runCiCase(core, fixturePayload, caseDefinition.execution);
    } else if (caseDefinition.execution.kind === "score") {
      payload = runScoreCase(core, fixturePayload, caseDefinition.execution);
    } else if (caseDefinition.execution.kind === "graph-algorithm") {
      payload = runGraphAlgorithmCase(
        core,
        discovery,
        fixturePayload,
        fixtureDefinition,
        caseDefinition.execution
      );
    } else if (caseDefinition.execution.kind === "structured-algorithm") {
      payload = runStructuredAlgorithmCase(core, discovery, fixturePayload, caseDefinition.execution);
    } else {
      throw new Error(`Unsupported execution kind: ${caseDefinition.execution.kind}`);
    }

    return {
      id: caseDefinition.id,
      componentId: selectComponentId(caseDefinition),
      fixtureId: caseDefinition.fixtureId,
      comparison: caseDefinition.comparison,
      runtimeMs: Number((performance.now() - startedAt).toFixed(3)),
      ...payload
    };
  });
}

module.exports = {
  runJsCases
};
