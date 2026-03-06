export interface NumericMatrix {
  readonly rows: number;
  readonly columns: number;
  at(row: number, column: number): number;
  column(index: number): readonly number[];
}

export interface ConditionalIndependenceTest {
  readonly name: string;
  test(x: number, y: number, conditioningSet?: readonly number[]): number;
}

export interface LocalScoreFunction {
  readonly name: string;
  score(node: number, parents: readonly number[]): number;
}
