/** Maidenhead grid locator <-> lat/lon, and great-circle distance/bearing. */

const FIELD = "ABCDEFGHIJKLMNOPQRSTUVWX";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Decode a 4 or 6 character Maidenhead grid locator to its center lat/lon. */
export function gridToLatLon(grid: string): LatLon {
  const g = grid.trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) {
    throw new Error(`Invalid grid locator: ${grid}`);
  }

  const lonField = FIELD.indexOf(g[0]);
  const latField = FIELD.indexOf(g[1]);
  const lonSquare = Number(g[2]);
  const latSquare = Number(g[3]);

  let lon = lonField * 20 - 180 + lonSquare * 2;
  let lat = latField * 10 - 90 + latSquare * 1;

  if (g.length === 6) {
    const lonSub = FIELD.indexOf(g[4]);
    const latSub = FIELD.indexOf(g[5]);
    lon += (lonSub * 5) / 60;
    lat += (latSub * 2.5) / 60;
    lon += 5 / 120;
    lat += 2.5 / 120;
  } else {
    lon += 1;
    lat += 0.5;
  }

  return { lat, lon };
}

export function isValidGrid(grid: string): boolean {
  try {
    gridToLatLon(grid);
    return true;
  } catch {
    return false;
  }
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two grid locators, in kilometers. */
export function gridDistanceKm(gridA: string, gridB: string): number {
  const a = gridToLatLon(gridA);
  const b = gridToLatLon(gridB);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/** Approximate local solar hour angle (0-24) for a longitude at a given UTC time, used to model day/night propagation. */
export function localSolarHour(lon: number, utcMs: number): number {
  const utcHours = (utcMs / 3_600_000) % 24;
  const offset = lon / 15;
  return (((utcHours + offset) % 24) + 24) % 24;
}

/** 1 for full daylight, 0 for full night, smoothly blended across dawn/dusk, based on local solar hour. */
export function daylightFactor(solarHour: number): number {
  // Simple model: daylight roughly 06:00-18:00 local, with a smooth
  // transition of ~1.5 hours at dawn/dusk instead of a hard edge.
  const distFromNoon = Math.abs(((solarHour - 12 + 12) % 24) - 12);
  const halfDay = 6; // hours from noon to sunrise/sunset
  const transition = 1.5;
  if (distFromNoon <= halfDay - transition) return 1;
  if (distFromNoon >= halfDay + transition) return 0;
  const t = (distFromNoon - (halfDay - transition)) / (2 * transition);
  return 0.5 * (1 + Math.cos(t * Math.PI));
}
