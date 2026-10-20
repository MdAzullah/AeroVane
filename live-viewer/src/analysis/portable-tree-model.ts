export interface PortableTreeModel {
  schema_version: '1.0.0';
  model_kind: 'binary-decision-tree';
  version: string;
  advisory_only: true;
  features: string[];
  imputation_medians: number[];
  persistence_windows: number;
  decision_threshold: number;
  lineage: { experiment?: string; report_sha256?: string; config_sha256?: string };
  tree: { feature_index: number[]; threshold: number[]; left: number[]; right: number[]; anomaly_probability: number[] };
}

export function validatePortableTreeModel(value: unknown): PortableTreeModel | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as PortableTreeModel;
  const count = model.tree?.feature_index?.length;
  if (model.schema_version !== '1.0.0' || model.model_kind !== 'binary-decision-tree' || model.advisory_only !== true) return null;
  if (!model.version || !model.features?.length || new Set(model.features).size !== model.features.length) return null;
  if (model.imputation_medians?.length !== model.features.length || !Number.isInteger(model.persistence_windows) || model.persistence_windows < 1) return null;
  if (!count || !['threshold', 'left', 'right', 'anomaly_probability'].every(key => (model.tree[key as keyof typeof model.tree] as number[])?.length === count)) return null;
  if (![...model.imputation_medians, ...model.tree.threshold, ...model.tree.anomaly_probability, model.decision_threshold].every(Number.isFinite)) return null;
  for (let index = 0; index < count; index += 1) {
    const feature = model.tree.feature_index[index];
    if (feature === -1) {
      if (model.tree.left[index] !== -1 || model.tree.right[index] !== -1) return null;
    } else if (!Number.isInteger(feature) || feature < 0 || feature >= model.features.length || model.tree.left[index] < 0 || model.tree.left[index] >= count || model.tree.right[index] < 0 || model.tree.right[index] >= count) return null;
    const probability = model.tree.anomaly_probability[index];
    if (probability < 0 || probability > 1) return null;
  }
  return model;
}

export function scorePortableTreeModel(value: unknown, values: Array<number | null | undefined>): number | null {
  const model = validatePortableTreeModel(value);
  if (!model || values.length !== model.features.length) return null;
  const filled = values.map((item, index) => item === null || item === undefined || !Number.isFinite(item) ? model.imputation_medians[index] : item);
  let node = 0;
  for (let visited = 0; visited <= model.tree.feature_index.length; visited += 1) {
    const feature = model.tree.feature_index[node];
    if (feature === -1) return model.tree.anomaly_probability[node];
    node = filled[feature]! <= model.tree.threshold[node] ? model.tree.left[node] : model.tree.right[node];
  }
  return null;
}
