import { describe, expect, it } from "vitest";

import {
  cloneExpressionTree,
  collectSummationVariables,
  constantNode,
  getFreeVariables,
  probabilityNode,
  productNode,
  quotientNode,
  renderEquation,
  renderExpressionTree,
  renderProbability,
  renderQuery,
  sumNode
} from "./expressions";
import type { IdentificationExpressionNode } from "./types";

// Test-only exact discrete interpretation. Every sum gets a fresh assignment;
// it never mutates its caller or sibling branches. No data estimator is used.
function evaluate(
  node: IdentificationExpressionNode,
  assignment: Record<string, number>,
  probability: (variables: string[], conditionedOn: string[], values: Record<string, number>) => number
): number {
  switch (node.type) {
    case "constant": return Number(node.value);
    case "probability": return probability(node.variables, node.conditionedOn, assignment);
    case "product": return node.factors.reduce((value, factor) => value * evaluate(factor, assignment, probability), 1);
    case "quotient": return evaluate(node.numerator, assignment, probability) / evaluate(node.denominator, assignment, probability);
    case "sum": {
      const enumerate = (index: number, current: Record<string, number>): number => index === node.variables.length
        ? evaluate(node.expression, current, probability)
        : [0, 1].reduce((total, value) => total + enumerate(index + 1, { ...current, [node.variables[index]!]: value }), 0);
      return enumerate(0, assignment);
    }
  }
}

describe("identification expression AST", () => {
  it("represents quotient kernels without cancelling observational denominators", () => {
    const joint = probabilityNode(["X", "Y"]);
    const kernel = quotientNode(joint, sumNode(["Y"], joint));
    expect(kernel).toEqual({
      type: "quotient",
      numerator: { type: "probability", variables: ["X", "Y"], conditionedOn: [] },
      denominator: {
        type: "sum", variables: ["Y"],
        expression: { type: "probability", variables: ["X", "Y"], conditionedOn: [] }
      }
    });
    expect(getFreeVariables(kernel)).toEqual(["X", "Y"]);
    expect(quotientNode(constantNode("0"), constantNode("0"))).toEqual({
      type: "quotient", numerator: { type: "constant", value: "0" }, denominator: { type: "constant", value: "0" }
    });
    expect(evaluate(quotientNode(constantNode("0"), constantNode("0")), {}, () => 0)).toBeNaN();
  });

  it("keeps each sum binding local to its subtree", () => {
    const expression = productNode(
      probabilityNode(["X"]),
      sumNode(["X"], productNode(probabilityNode(["Y"], ["X"]), probabilityNode(["X"])))
    );
    const assignment = { X: 1, Y: 1 };
    const oracle = (variables: string[], _given: string[], values: Record<string, number>): number => {
      if (variables[0] === "X") return values.X === 1 ? 0.25 : 0.75;
      return values.X === 1 ? 0.8 : 0.2;
    };
    expect(getFreeVariables(expression)).toEqual(["X", "Y"]);
    expect(evaluate(expression, assignment, oracle)).toBeCloseTo(0.25 * (0.75 * 0.2 + 0.25 * 0.8), 14);
    expect(assignment).toEqual({ X: 1, Y: 1 });

    const reversed = productNode(sumNode(["X"], probabilityNode(["X"])), probabilityNode(["X"]));
    expect(getFreeVariables(reversed)).toEqual(["X"]);
    expect(evaluate(reversed, assignment, oracle)).toBeCloseTo(0.25, 14);
  });

  it("does not globally rename or merge nested binders and exact node IDs", () => {
    const expression = sumNode(["treatment"], productNode(
      probabilityNode(["outcome"], ["treatment", "treatment'", "long variable"]),
      sumNode(["treatment"], probabilityNode(["treatment"], ["treatment'"]))
    ));
    expect(getFreeVariables(expression)).toEqual(["outcome", "treatment'", "long variable"]);
    expect(collectSummationVariables(expression)).toEqual(["treatment"]);
    expect(renderExpressionTree(expression)).toContain("P(outcome | treatment, treatment', long variable)");
    expect(evaluate(sumNode(["X"], sumNode(["X"], constantNode("1"))), {}, () => 0)).toBe(4);
    expect(getFreeVariables(quotientNode(
      sumNode(["X"], probabilityNode(["Y"], ["X"])), probabilityNode(["X'"], ["X"])
    ))).toEqual(["Y", "X'", "X"]);
  });

  it("preserves empty-product and empty-index-set semantics", () => {
    const factor = probabilityNode(["Y"]);
    expect(productNode()).toEqual(constantNode("1"));
    expect(probabilityNode([], ["X"])).toEqual(constantNode("1"));
    expect(sumNode([], factor)).toEqual(factor);
    expect(sumNode([], factor)).not.toBe(factor);
    expect(productNode(factor)).toEqual(factor);
    expect(productNode(factor)).not.toBe(factor);
    expect(sumNode(["X", "X"], factor)).toMatchObject({ variables: ["X"] });
    expect(renderExpressionTree({ type: "product", factors: [] })).toBe("1");
    expect(renderExpressionTree({ type: "sum", variables: [], expression: factor })).toBe("P(Y)");
    expect(getFreeVariables(constantNode("1"))).toEqual([]);
  });

  it("renders sum boundaries and nested quotients unambiguously", () => {
    const sum = sumNode(["X"], probabilityNode(["X"]));
    expect(renderExpressionTree(productNode(sum, probabilityNode(["Y"], ["X"]))))
      .toBe("(Σ_X P(X)) P(Y | X)");
    expect(renderExpressionTree(productNode(productNode(probabilityNode(["Z"]), sum), probabilityNode(["Y"]))))
      .toBe("(P(Z) Σ_X P(X)) P(Y)");
    expect(renderExpressionTree(quotientNode(sum, quotientNode(probabilityNode(["Y"]), probabilityNode(["Z"])))))
      .toBe("(Σ_X P(X)) / ((P(Y)) / (P(Z)))");
    expect(renderExpressionTree(productNode(quotientNode(probabilityNode(["X", "Y"]), probabilityNode(["X"])), sum)))
      .toBe("((P(X, Y)) / (P(X))) Σ_X P(X)");
    expect(renderExpressionTree(sumNode(["X"], sum))).toBe("Σ_X (Σ_X P(X))");
  });

  it("preserves existing backdoor and frontdoor display forms", () => {
    expect(renderProbability(["Y"], ["X", "Z"])).toBe("P(Y | X, Z)");
    expect(renderEquation(renderQuery("X", "Y"), sumNode(["Z"], productNode(
      probabilityNode(["Y"], ["X", "Z"]), probabilityNode(["Z"])
    )))).toBe("P(Y | do(X)) = Σ_Z P(Y | X, Z) P(Z)");
    const frontdoor = sumNode(["M"], productNode(
      probabilityNode(["M"], ["X"]),
      sumNode(["X'"], productNode(probabilityNode(["Y"], ["M", "X'"]), probabilityNode(["X'"])))
    ));
    expect(renderEquation(renderQuery("X", "Y"), frontdoor))
      .toBe("P(Y | do(X)) = Σ_M P(M | X) Σ_X' P(Y | M, X') P(X')");
  });

  it("detaches nested inputs and round-trips through JSON without hidden state", () => {
    const variables = ["Y"];
    const conditionedOn = ["X"];
    const probability = probabilityNode(variables, conditionedOn);
    const sumVariables = ["Y"];
    const sum = sumNode(sumVariables, probability);
    const product = productNode(sum, probability);
    const quotient = quotientNode(product, sum);
    const snapshot = JSON.parse(JSON.stringify(quotient)) as IdentificationExpressionNode;
    const clone = cloneExpressionTree(quotient);
    variables[0] = "changed";
    conditionedOn.length = 0;
    sumVariables.push("changed");
    if (probability.type === "probability") probability.variables.push("changed");
    if (sum.type === "sum") sum.variables.push("changed");
    if (product.type === "product") product.factors.length = 0;
    expect(quotient).toEqual(snapshot);
    expect(clone).toEqual(snapshot);
    expect(clone).not.toBe(quotient);
    if (quotient.type === "quotient" && quotient.denominator.type === "sum") {
      quotient.denominator.variables.push("changed");
    }
    expect(clone).toEqual(snapshot);
  });
});
