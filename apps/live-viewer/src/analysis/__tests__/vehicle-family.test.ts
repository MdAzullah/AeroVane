import { describe, expect, it } from 'vitest';
import { routeMavTypeToVehicleFamily } from '../vehicle-family';

describe('routeMavTypeToVehicleFamily', () => {
  it.each([
    [1, 'fixed_wing'],
    [2, 'multicopter'], [3, 'multicopter'], [4, 'multicopter'],
    [10, 'ground_rover'], [11, 'surface_vessel'], [12, 'submersible'],
    [13, 'multicopter'], [14, 'multicopter'], [15, 'multicopter'],
    [19, 'vtol_hybrid'], [20, 'vtol_hybrid'], [21, 'vtol_hybrid'],
    [7, 'lighter_than_air_other'], [8, 'lighter_than_air_other'],
  ] as const)('routes MAV_TYPE %i to %s', (mavType, family) => {
    expect(routeMavTypeToVehicleFamily(mavType)).toBe(family);
  });

  it.each([0, 5, 6, 18, 26, 30, -1, 1.5, Number.NaN, 256])(
    'abstains for unknown or non-vehicle type %s',
    mavType => expect(routeMavTypeToVehicleFamily(mavType)).toBe('unknown'),
  );
});
