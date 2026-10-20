export interface PortableDenseModel {
  schema_version: '1.0.0';
  model_kind: 'multiclass-dense-network';
  version: string;
  advisory_only: true;
  simulation_trained: true;
  component_diagnosis: false;
  features: string[];
  classes: string[];
  imputation_medians: number[];
  standardization_means: number[];
  standardization_scales: number[];
  unknown_confidence_threshold: number;
  minimum_observed_signal_families: number;
  layers: Array<{ activation: 'relu' | 'softmax'; weights: number[][]; bias: number[] }>;
  lineage: { experiment?: string; report_sha256?: string; model_sha256?: string };
}

export interface DenseModelScore { predictedClass: string; confidence: number; probabilities: number[] }

export function validatePortableDenseModel(value: unknown): PortableDenseModel | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as PortableDenseModel;
  const width = model.features?.length;
  if (model.schema_version !== '1.0.0' || model.model_kind !== 'multiclass-dense-network'
      || model.advisory_only !== true || model.simulation_trained !== true || model.component_diagnosis !== false
      || !width || new Set(model.features).size !== width || !model.classes?.length || new Set(model.classes).size !== model.classes.length) return null;
  if (![model.imputation_medians, model.standardization_means, model.standardization_scales].every(items => items?.length === width)) return null;
  if (!Number.isFinite(model.unknown_confidence_threshold) || model.unknown_confidence_threshold <= 0 || model.unknown_confidence_threshold >= 1
      || !Number.isInteger(model.minimum_observed_signal_families) || model.minimum_observed_signal_families < 1 || !model.layers?.length) return null;
  let inputs = width;
  for (let index = 0; index < model.layers.length; index += 1) {
    const layer = model.layers[index];
    if (!layer.bias?.length || layer.weights?.length !== layer.bias.length || layer.weights.some(row => row.length !== inputs)) return null;
    if (layer.activation !== (index === model.layers.length - 1 ? 'softmax' : 'relu')) return null;
    inputs = layer.bias.length;
  }
  if (inputs !== model.classes.length || model.standardization_scales.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const numbers = [...model.imputation_medians, ...model.standardization_means, ...model.standardization_scales,
    ...model.layers.flatMap(layer => [...layer.bias, ...layer.weights.flat()])];
  return numbers.every(Number.isFinite) ? model : null;
}

export function scorePortableDenseModel(value: unknown, values: Array<number | null | undefined>): DenseModelScore | null {
  const model = validatePortableDenseModel(value);
  if (!model || values.length !== model.features.length) return null;
  let current = values.map((item, index) => {
    const filled = item === null || item === undefined || !Number.isFinite(item) ? model.imputation_medians[index] : item;
    return Math.max(-10, Math.min(10, (filled - model.standardization_means[index]) / model.standardization_scales[index]));
  });
  for (const layer of model.layers) {
    current = layer.weights.map((weights, output) => weights.reduce((sum, weight, input) => sum + weight * current[input], layer.bias[output]));
    if (layer.activation === 'relu') current = current.map(item => Math.max(0, item));
    else {
      const maximum = Math.max(...current); const exponential = current.map(item => Math.exp(item - maximum)); const total = exponential.reduce((sum, item) => sum + item, 0);
      current = exponential.map(item => item / total);
    }
  }
  const confidence = Math.max(...current); const index = current.indexOf(confidence);
  return { predictedClass: confidence >= model.unknown_confidence_threshold ? model.classes[index] : 'unknown_anomaly', confidence, probabilities: current };
}
