import { describe, expect, it } from 'vitest';
import model from '../models/basic-sensor-model.json';
import { scorePortableDenseModel, validatePortableDenseModel } from '../portable-dense-model';

describe('portable dense-network contract', () => {
  it('validates the bundled BASiC artifact and matches the Python reference score', () => {
    const valid = validatePortableDenseModel(model);
    expect(valid?.version).toBe('skyforge-basic-sensor-1.0.0');
    const score = scorePortableDenseModel(model, model.imputation_medians);
    expect(score?.predictedClass).toBe('compass_failure');
    expect(score?.probabilities[4]).toBeCloseTo(0.9937159925080079, 10);
  });

  it('fails closed on malformed dimensions', () => {
    expect(validatePortableDenseModel({ ...model, standardization_scales: [1] })).toBeNull();
    expect(scorePortableDenseModel(model, [1])).toBeNull();
  });
});
