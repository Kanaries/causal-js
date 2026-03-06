export interface BackgroundKnowledgeShape {
  forbidden: Array<{ from: string; to: string }>;
  required: Array<{ from: string; to: string }>;
  forbiddenPatterns: Array<{ from: string; to: string }>;
  requiredPatterns: Array<{ from: string; to: string }>;
  tiers: Array<{ tier: number; nodes: string[] }>;
  forbiddenWithinTiers: number[];
}

function makeEdgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function parseEdgeKey(key: string): { from: string; to: string } {
  const [from, to] = key.split("->");
  if (!from || !to) {
    throw new Error(`Invalid edge key: ${key}`);
  }

  return { from, to };
}

export class BackgroundKnowledge {
  private readonly forbiddenRules = new Set<string>();
  private readonly requiredRules = new Set<string>();
  private readonly forbiddenPatterns: Array<{ from: string; to: string }> = [];
  private readonly requiredPatterns: Array<{ from: string; to: string }> = [];
  private readonly tierMembers = new Map<number, Set<string>>();
  private readonly tierByNode = new Map<string, number>();
  private readonly forbiddenWithinTiers = new Set<number>();

  addForbidden(from: string, to: string): this {
    this.forbiddenRules.add(makeEdgeKey(from, to));
    return this;
  }

  removeForbidden(from: string, to: string): this {
    this.forbiddenRules.delete(makeEdgeKey(from, to));
    return this;
  }

  addRequired(from: string, to: string): this {
    this.requiredRules.add(makeEdgeKey(from, to));
    return this;
  }

  removeRequired(from: string, to: string): this {
    this.requiredRules.delete(makeEdgeKey(from, to));
    return this;
  }

  addForbiddenPattern(from: string, to: string): this {
    this.forbiddenPatterns.push({ from, to });
    return this;
  }

  addRequiredPattern(from: string, to: string): this {
    this.requiredPatterns.push({ from, to });
    return this;
  }

  addNodeToTier(nodeId: string, tier: number): this {
    if (!Number.isInteger(tier) || tier < 0) {
      throw new Error(`Tier must be a non-negative integer: ${tier}`);
    }

    const members = this.tierMembers.get(tier) ?? new Set<string>();
    members.add(nodeId);
    this.tierMembers.set(tier, members);
    this.tierByNode.set(nodeId, tier);
    return this;
  }

  forbidWithinTier(tier: number): this {
    if (!Number.isInteger(tier) || tier < 0) {
      throw new Error(`Tier must be a non-negative integer: ${tier}`);
    }

    this.forbiddenWithinTiers.add(tier);
    return this;
  }

  isForbidden(from: string, to: string): boolean {
    if (this.forbiddenRules.has(makeEdgeKey(from, to))) {
      return true;
    }

    if (this.matches(this.forbiddenPatterns, from, to)) {
      return true;
    }

    const fromTier = this.tierByNode.get(from);
    const toTier = this.tierByNode.get(to);
    if (fromTier === undefined || toTier === undefined) {
      return false;
    }

    return fromTier > toTier || (fromTier === toTier && this.forbiddenWithinTiers.has(fromTier));
  }

  isRequired(from: string, to: string): boolean {
    if (this.requiredRules.has(makeEdgeKey(from, to))) {
      return true;
    }

    return this.matches(this.requiredPatterns, from, to);
  }

  toShape(): BackgroundKnowledgeShape {
    return {
      forbidden: [...this.forbiddenRules].map(parseEdgeKey),
      required: [...this.requiredRules].map(parseEdgeKey),
      forbiddenPatterns: [...this.forbiddenPatterns],
      requiredPatterns: [...this.requiredPatterns],
      tiers: [...this.tierMembers.entries()].map(([tier, nodes]) => ({
        tier,
        nodes: [...nodes].sort()
      })),
      forbiddenWithinTiers: [...this.forbiddenWithinTiers].sort((left, right) => left - right)
    };
  }

  static fromShape(shape: BackgroundKnowledgeShape): BackgroundKnowledge {
    const knowledge = new BackgroundKnowledge();

    for (const rule of shape.forbidden) {
      knowledge.addForbidden(rule.from, rule.to);
    }

    for (const rule of shape.required) {
      knowledge.addRequired(rule.from, rule.to);
    }

    for (const pattern of shape.forbiddenPatterns) {
      knowledge.addForbiddenPattern(pattern.from, pattern.to);
    }

    for (const pattern of shape.requiredPatterns) {
      knowledge.addRequiredPattern(pattern.from, pattern.to);
    }

    for (const tierEntry of shape.tiers) {
      for (const nodeId of tierEntry.nodes) {
        knowledge.addNodeToTier(nodeId, tierEntry.tier);
      }
    }

    for (const tier of shape.forbiddenWithinTiers) {
      knowledge.forbidWithinTier(tier);
    }

    return knowledge;
  }

  private matches(
    patterns: Array<{ from: string; to: string }>,
    from: string,
    to: string
  ): boolean {
    return patterns.some((pattern) => {
      const fromRegex = new RegExp(pattern.from);
      const toRegex = new RegExp(pattern.to);
      return fromRegex.test(from) && toRegex.test(to);
    });
  }
}
