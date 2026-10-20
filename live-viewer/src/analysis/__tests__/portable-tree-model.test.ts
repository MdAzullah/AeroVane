import { describe, expect, it } from 'vitest';
import { scorePortableTreeModel, validatePortableTreeModel } from '../portable-tree-model';

const artifact = {
  schema_version: '1.0.0', model_kind: 'binary-decision-tree', version: 'test', advisory_only: true,
  features: ['a', 'b'], imputation_medians: [2, 3], persistence_windows: 2, decision_threshold: 0.5, lineage: {},
  tree: { feature_index: [0, -1, -1], threshold: [1.5, -2, -2], left: [1, -1, -1], right: [2, -1, -1], anomaly_probability: [0.5, 0.1, 0.9] },
} as const;

describe('portable decision-tree model contract', () => {
  it('matches the Python reference branch and imputation behavior', () => {
    expect(scorePortableTreeModel(artifact, [1, 8])).toBe(0.1);
    expect(scorePortableTreeModel(artifact, [2, 8])).toBe(0.9);
    expect(scorePortableTreeModel(artifact, [null, 8])).toBe(0.9);
  });

  it('fails closed for invalid nodes and vectors', () => {
    const invalid = structuredClone(artifact) as any;
    invalid.tree.right[0] = 99;
    expect(validatePortableTreeModel(invalid)).toBeNull();
    expect(scorePortableTreeModel(artifact, [1])).toBeNull();
  });
});
