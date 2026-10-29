import type { FaultDetector } from './detector';
import {
  AltitudeLossFaultDetector,
  AttitudeFaultDetector,
  BatteryFaultDetector,
  BasicSensorFaultDetector,
  CommunicationFaultDetector,
  EkfFaultDetector,
  GpsFaultDetector,
  MotorImbalanceFaultDetector,
  SensorStalenessFaultDetector,
  StatusTextFaultDetector,
  TemperatureFaultDetector,
  RealAnomalyDetector,
  VibrationFaultDetector,
} from './detectors';

/** Fresh detector instances for one independent live or saved-log session. */
export function createDefaultFaultDetectors(): FaultDetector[] {
  return [
    new BatteryFaultDetector(),
    new GpsFaultDetector(),
    new CommunicationFaultDetector(),
    new VibrationFaultDetector(),
    new AttitudeFaultDetector(),
    new AltitudeLossFaultDetector(),
    new EkfFaultDetector(),
    new SensorStalenessFaultDetector(),
    new MotorImbalanceFaultDetector(),
    new TemperatureFaultDetector(),
    new StatusTextFaultDetector(),
    new RealAnomalyDetector(),
    new BasicSensorFaultDetector(),
  ];
}
