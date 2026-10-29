import type { VehicleFamily } from './types';

/**
 * Routes MAV_TYPE values to the frozen ML vehicle taxonomy.
 * Unknown and non-vehicle MAV types deliberately abstain from ML routing.
 */
export function routeMavTypeToVehicleFamily(mavType: number): VehicleFamily {
  if (!Number.isInteger(mavType) || mavType < 0 || mavType > 255) return 'unknown';

  switch (mavType) {
    case 1: // MAV_TYPE_FIXED_WING
      return 'fixed_wing';
    case 2: // QUADROTOR
    case 3: // COAXIAL
    case 4: // HELICOPTER
    case 13: // HEXAROTOR
    case 14: // OCTOROTOR
    case 15: // TRICOPTER
    case 29: // DODECAROTOR
    case 35: // DECAROTOR
      return 'multicopter';
    case 10: // GROUND_ROVER
      return 'ground_rover';
    case 11: // SURFACE_BOAT
      return 'surface_vessel';
    case 12: // SUBMARINE
      return 'submersible';
    case 19: // VTOL_DUOROTOR
    case 20: // VTOL_QUADROTOR
    case 21: // VTOL_TILTROTOR
    case 22: // VTOL_RESERVED2
    case 23: // VTOL_RESERVED3
    case 24: // VTOL_RESERVED4
    case 25: // VTOL_RESERVED5
      return 'vtol_hybrid';
    case 7: // AIRSHIP
    case 8: // FREE_BALLOON
    case 16: // FLAPPING_WING
    case 17: // KITE
    case 28: // PARAFOIL
      return 'lighter_than_air_other';
    default:
      return 'unknown';
  }
}
