const EARTH_RADIUS_METRES = 6_371_000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat-earth approximation: office geofences are
 * typically 100-500m, and at that scale a naive degrees-to-metres conversion is
 * wrong by enough to admit punches from the car park across the road.
 */
export const distanceInMetres = (from, to) => {
  if (!from || !to) return Infinity;

  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a)));
};

export const isValidCoordinate = (location) =>
  Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      Math.abs(location.latitude) <= 90 &&
      Math.abs(location.longitude) <= 180,
  );

/**
 * Checks a punch location against the tenant's allowed sites.
 *
 * Returns the nearest site and whether it is within range, rather than a bare
 * boolean -- a rejected punch should tell the employee which office it expected
 * and how far off they were, otherwise the failure is unactionable.
 *
 * `accuracy` is added to the radius: a phone reporting ±50m cannot be held to a
 * 100m fence it might genuinely be inside.
 */
export const checkGeofence = (location, sites = [], { defaultRadiusMetres = 200 } = {}) => {
  if (!isValidCoordinate(location)) {
    return { allowed: false, reason: 'INVALID_COORDINATES', nearest: null, distance: null };
  }

  if (!sites.length) {
    // No fence configured is not the same as a failed fence.
    return { allowed: true, reason: 'NO_GEOFENCE_CONFIGURED', nearest: null, distance: null };
  }

  const tolerance = Math.min(location.accuracy ?? 0, 100);

  let nearest = null;
  let shortest = Infinity;

  for (const site of sites) {
    const distance = distanceInMetres(location, site);
    if (distance < shortest) {
      shortest = distance;
      nearest = site;
    }
  }

  const radius = (nearest?.radiusMetres ?? defaultRadiusMetres) + tolerance;

  return {
    allowed: shortest <= radius,
    reason: shortest <= radius ? 'INSIDE_GEOFENCE' : 'OUTSIDE_GEOFENCE',
    nearest: nearest ? { name: nearest.name, radiusMetres: nearest.radiusMetres } : null,
    distance: shortest,
  };
};

export default { distanceInMetres, checkGeofence, isValidCoordinate };
