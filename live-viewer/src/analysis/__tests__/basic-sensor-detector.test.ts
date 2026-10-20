import { describe, expect, it } from 'vitest';
import { BasicSensorFaultDetector, aggregateBasicSignals, observeBasicSignals } from '../detectors/basic-sensor-detector';
import type { PortableDenseModel } from '../portable-dense-model';
import type { TelemetrySample } from '../types';

const artifact: PortableDenseModel = {
  schema_version:'1.0.0', model_kind:'multiclass-dense-network', version:'fixture', advisory_only:true, simulation_trained:true, component_diagnosis:false,
  features:['GPS.NSats_mean','IMU.AccX_mean','ATT.Roll_mean','BAT.Volt_mean'], classes:['normal','gps_failure'],
  imputation_medians:[0,0,0,0], standardization_means:[0,0,0,0], standardization_scales:[1,1,1,1],
  unknown_confidence_threshold:0.65, minimum_observed_signal_families:4,
  layers:[{ activation:'softmax', weights:[[0,0,0,0],[0,0,0,0]], bias:[0,4] }], lineage:{},
};

function sample(timestampMs: number, source: 'dataflash' | 'live' = 'dataflash'): TelemetrySample {
  return { timestampMs, source, flightPhase:'flying', values:{ 'gps.satellites':10, 'imu.xacc_mps2':1, 'attitude.roll_rad':Math.PI / 2, 'battery.voltage_v':15 }, availability:{}, units:{} };
}

describe('BASiC simulation-trained sensor detector', () => {
  it('maps canonical signals and aggregates population statistics', () => {
    expect(observeBasicSignals(sample(0).values)).toMatchObject({ 'GPS.NSats':10, 'IMU.AccX':1, 'ATT.Roll':90, 'BAT.Volt':15 });
    expect(aggregateBasicSignals([{ timestampMs:0, values:{ 'GPS.NSats':8 } }, { timestampMs:1, values:{ 'GPS.NSats':12 } }], ['GPS.NSats_mean','GPS.NSats_std'])).toEqual([10,2]);
  });

  it('emits a cautious non-diagnostic advisory after persistence', () => {
    const detector = new BasicSensorFaultDetector(artifact); let findings = [] as ReturnType<typeof detector.evaluate>;
    for (let timestamp = 0; timestamp <= 8_000; timestamp += 1_000) findings = detector.evaluate(sample(timestamp));
    const finding = findings.at(-1);
    expect(finding).toMatchObject({ status:'active', faultType:'ML_GPS_SENSOR_PATTERN', severity:'caution' });
    expect(finding?.status === 'active' ? finding.message : '').toContain('not a confirmed diagnosis');
  });

  it('fails closed for a live sample without multicopter routing', () => {
    expect(new BasicSensorFaultDetector(artifact).evaluate(sample(8_000, 'live'))).toEqual([]);
  });
});
