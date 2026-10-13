import type { IdentificationExpressionNode } from "./types";

export function renderQuery(treatment: string, outcome: string): string {
  return `P(${outcome} | do(${treatment}))`;
}

export function renderProbability(variables: readonly string[], conditionedOn: readonly string[] = []): string {
  const variableList = variables.join(", ");
  return conditionedOn.length === 0
    ? `P(${variableList})`
    : `P(${variableList} | ${conditionedOn.join(", ")})`;
}

/** A structural clone: callers cannot mutate a parent through a supplied child. */
export function cloneExpressionTree(node: IdentificationExpressionNode): IdentificationExpressionNode {
  switch (node.type) {
    case "constant":
      return { type: "constant", value: node.value };
    case "probability":
      return { type: "probability", variables: [...node.variables], conditionedOn: [...node.conditionedOn] };
    case "product":
      return { type: "product", factors: node.factors.map(cloneExpressionTree) };
    case "sum":
      return { type: "sum", variables: [...node.variables], expression: cloneExpressionTree(node.expression) };
    case "quotient":
      return {
        type: "quotient",
        numerator: cloneExpressionTree(node.numerator),
        denominator: cloneExpressionTree(node.denominator)
      };
  }
}

export function probabilityNode(
  variables: readonly string[],
  conditionedOn: readonly string[] = []
): IdentificationExpressionNode {
  // The probability of an empty event is one, including conditional kernels.
  return variables.length === 0
    ? constantNode("1")
    : { type: "probability", variables: [...variables], conditionedOn: [...conditionedOn] };
}

export function constantNode(value: string): IdentificationExpressionNode {
  return { type: "constant", value };
}

export function productNode(...factors: IdentificationExpressionNode[]): IdentificationExpressionNode {
  if (factors.length === 0) return constantNode("1");
  if (factors.length === 1) return cloneExpressionTree(factors[0]!);
  return { type: "product", factors: factors.map(cloneExpressionTree) };
}

/**
 * Bind the exact node identifiers only within this expression. A name may be
 * bound here and remain free in a sibling subtree; apostrophes have no special
 * meaning and are never interpreted as aliases for another graph node.
 */
export function sumNode(
  variables: readonly string[],
  expression: IdentificationExpressionNode
): IdentificationExpressionNode {
  if (variables.length === 0) return cloneExpressionTree(expression);
  return { type: "sum", variables: [...new Set(variables)], expression: cloneExpressionTree(expression) };
}

/** No cancellation is performed: an observational denominator may be zero. */
export function quotientNode(
  numerator: IdentificationExpressionNode,
  denominator: IdentificationExpressionNode
): IdentificationExpressionNode {
  return {
    type: "quotient",
    numerator: cloneExpressionTree(numerator),
    denominator: cloneExpressionTree(denominator)
  };
}

/** Free variables in first-appearance order, respecting each sum's local scope. */
export function getFreeVariables(node: IdentificationExpressionNode): string[] {
  const free = new Set<string>();
  const visit = (current: IdentificationExpressionNode, bound: ReadonlySet<string>): void => {
    switch (current.type) {
      case "constant":
        return;
      case "probability":
        for (const name of [...current.variables, ...current.conditionedOn]) {
          if (!bound.has(name)) free.add(name);
        }
        return;
      case "product":
        for (const factor of current.factors) visit(factor, bound);
        return;
      case "sum":
        visit(current.expression, new Set([...bound, ...current.variables]));
        return;
      case "quotient":
        visit(current.numerator, bound);
        visit(current.denominator, bound);
    }
  };
  visit(node, new Set());
  return [...free];
}

/** Names used by sum binders; this is a display inventory, not a global scope. */
export function collectSummationVariables(node: IdentificationExpressionNode): string[] {
  const variables = new Set<string>();
  const visit = (current: IdentificationExpressionNode): void => {
    switch (current.type) {
      case "constant":
      case "probability":
        return;
      case "product":
        current.factors.forEach(visit);
        return;
      case "sum":
        current.variables.forEach((variable) => variables.add(variable));
        visit(current.expression);
        return;
      case "quotient":
        visit(current.numerator);
        visit(current.denominator);
    }
  };
  visit(node);
  return [...variables];
}

export function renderExpressionTree(node: IdentificationExpressionNode): string {
  switch (node.type) {
    case "constant":
      return node.value;
    case "probability":
      return node.variables.length === 0 ? "1" : renderProbability(node.variables, node.conditionedOn);
    case "product":
      if (node.factors.length === 0) return "1";
      return node.factors.map((factor, index) => {
        const rendered = renderExpressionTree(factor);
        // A final sum extends to the end of the product and preserves the
        // established frontdoor display. Earlier sums need a closing boundary.
        return factor.type === "quotient" || factor.type === "product" || (factor.type === "sum" && index < node.factors.length - 1)
          ? `(${rendered})`
          : rendered;
      }).join(" ");
    case "sum": {
      const rendered = renderExpressionTree(node.expression);
      if (node.variables.length === 0) return rendered;
      return `Σ_${node.variables.join(",")} ${node.expression.type === "sum" ? `(${rendered})` : rendered}`;
    }
    case "quotient":
      return `(${renderExpressionTree(node.numerator)}) / (${renderExpressionTree(node.denominator)})`;
  }
}

export function renderEquation(query: string, expressionTree: IdentificationExpressionNode): string {
  return `${query} = ${renderExpressionTree(expressionTree)}`;
}
