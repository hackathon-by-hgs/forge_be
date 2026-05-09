/** Earth radius in meters. */
const R = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two WGS84 points, in meters. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** 5 km/h walking pace → minutes. */
export const walkingMinutes = (meters: number) => Math.max(1, Math.round(meters / (5000 / 60)));

/** 25 km/h Lagos-realistic driving pace → minutes. */
export const drivingMinutes = (meters: number) => Math.max(1, Math.round(meters / (25_000 / 60)));
