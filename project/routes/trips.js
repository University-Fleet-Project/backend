const express = require('express');
const { pool } = require('../config/db');
const { ok, fail, pagination, paged, audit, notify, addTripHistory, userId, checkVehicleAvailability } = require('../utils');
const { requireAuth, allowRoles, normalizeRole } = require('../middleware/auth');

const router = express.Router();

async function isAssignedDriver(clientOrPool, userSub, assignedDriverId) {
  if (!userSub || assignedDriverId == null) return false;
  const subStr = String(userSub);
  const assignedStr = String(assignedDriverId);
  if (subStr === assignedStr) return true;
  const res = await clientOrPool.query(
    `SELECT 1 FROM drivers WHERE CAST(user_id AS TEXT) = $1 AND CAST(driver_id AS TEXT) = $2 LIMIT 1`,
    [subStr, assignedStr]
  );
  return res.rows.length > 0;
}

/**
 * Format location ping row to ensure numeric coordinate, speed, and accuracy fields are JSON Numbers.
 */
function formatLocationPing(ping) {
  if (!ping) return ping;
  return {
    ...ping,
    latitude: ping.latitude != null ? Number(ping.latitude) : null,
    longitude: ping.longitude != null ? Number(ping.longitude) : null,
    speed_kmh: ping.speed_kmh != null ? Number(ping.speed_kmh) : null,
    accuracy_meters: ping.accuracy_meters != null ? Number(ping.accuracy_meters) : null
  };
}

/**
 * Flexible trip resolver supporting integer IDs (e.g. 5), formatted trip IDs (e.g. 'FLT-TRIP-0001' or 'FLT-TRIP-5'),
 * or reservation IDs (e.g. 'FLT-RES-0001').
 */
async function findTrip(clientOrPool, rawId, forUpdate = false) {
  if (!rawId) return null;
  const str = String(rawId).trim();
  if (!str) return null;

  let numId = null;
  if (/^\d+$/.test(str)) {
    numId = parseInt(str, 10);
  } else if (/^FLT-TRIP-\d+$/i.test(str)) {
    numId = parseInt(str.replace(/^FLT-TRIP-/i, ''), 10);
  }

  const lockClause = forUpdate ? ' FOR UPDATE' : '';
  const query = `
    SELECT t.*,
           r.vehicle_id,
           r.driver_id AS res_driver_id,
           r.status AS reservation_status,
           r.origin,
           r.destination,
           r.requester_id,
           r.passengers,
           r.load_kg,
           r.trip_start_timestamp,
           r.trip_end_timestamp
    FROM trips t
    JOIN reservations r ON r.reservation_id = t.reservation_id
    WHERE ($1::integer IS NOT NULL AND t.trip_id = $1::integer)
       OR r.reservation_id = $2
    ${lockClause}
  `;

  try {
    const res = await clientOrPool.query(query, [numId, str]);
    return res.rows[0] || null;
  } catch (e) {
    console.error('Error finding trip:', e);
    return null;
  }
}

router.get('/my', requireAuth, async (req, res) => {
  try {
    const sub = String(userId(req));
    const r = await pool.query(
      `SELECT t.*, r.vehicle_id, r.origin, r.destination, r.trip_start_timestamp, r.trip_end_timestamp, r.status AS reservation_status
       FROM trips t
       JOIN reservations r ON r.reservation_id = t.reservation_id
       LEFT JOIN drivers d ON (d.driver_id = t.driver_id OR d.driver_id = r.driver_id)
       WHERE CAST(t.driver_id AS TEXT) = $1
          OR CAST(r.driver_id AS TEXT) = $1
          OR CAST(d.user_id AS TEXT) = $1
          OR CAST(r.requester_id AS TEXT) = $1
       ORDER BY t.created_at DESC`,
      [sub]
    );
    return ok(res, r.rows);
  } catch (e) {
    return fail(res, 500, 'TRIPS_ERROR', 'Unable to list your trips.');
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const trip = await findTrip(pool, req.params.id);
    if (!trip) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    return ok(res, trip);
  } catch (e) {
    return fail(res, 500, 'TRIP_ERROR', 'Unable to get trip.');
  }
});

router.post('/:id/assign', requireAuth, allowRoles('dispatcher', 'fleet_admin'), async (req, res) => {
  const { vehicleId, driverId, reason } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = await findTrip(client, req.params.id, true);
    if (!x) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(vehicleId)]);
    const avail = await checkVehicleAvailability(client, vehicleId, x.trip_start_timestamp, x.trip_end_timestamp, { excludeReservationId: x.reservation_id });
    if (!avail.available) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'VEHICLE_CONFLICT', 'Vehicle overlaps another trip or maintenance.');
    }
    await client.query(`UPDATE reservations SET vehicle_id=$1, driver_id=$2 WHERE reservation_id=$3`, [vehicleId, driverId, x.reservation_id]);
    await client.query(`UPDATE trips SET driver_id=$1 WHERE trip_id=$2`, [driverId, x.trip_id]);
    await client.query('COMMIT');
    await audit(userId(req), 'ASSIGN_DRIVER', 'trip', String(x.trip_id), { driverId, vehicleId, reason });
    await audit(userId(req), 'ASSIGN_VEHICLE', 'trip', String(x.trip_id), { vehicleId, driverId });
    return ok(res, { tripId: x.trip_id, vehicleId, driverId }, 'Trip assigned');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return fail(res, 500, 'ASSIGN_ERROR', 'Unable to assign trip.');
  } finally {
    client.release();
  }
});

router.post('/:id/dispatch', requireAuth, allowRoles('dispatcher', 'fleet_admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = await findTrip(client, req.params.id, true);
    if (!x) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }
    const currentStatus = x.reservation_status || x.status;
    if (currentStatus !== 'approved') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'INVALID_STATUS', 'Trip must be approved before dispatch.');
    }
    await client.query(`UPDATE reservations SET status='dispatched' WHERE reservation_id=$1`, [x.reservation_id]);
    await client.query('COMMIT');
    await addTripHistory(x.trip_id, 'approved', 'dispatched', userId(req), req.body?.reason);
    await audit(userId(req), 'DISPATCH_TRIP', 'trip', String(x.trip_id));
    return ok(res, null, 'Trip dispatched');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return fail(res, 500, 'DISPATCH_ERROR', 'Unable to dispatch trip.');
  } finally {
    client.release();
  }
});

router.post('/:id/start', requireAuth, allowRoles('driver'), async (req, res) => {
  const { odometerStart, odometer_start, latitude, longitude, timestamp } = req.body;
  const odo = odometerStart ?? odometer_start;
  if (odo == null) return fail(res, 400, 'VALIDATION_ERROR', 'odometerStart is required.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = await findTrip(client, req.params.id, true);
    if (!x) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }
    const assignedDriver = x.driver_id ?? x.res_driver_id;
    const authorized = await isAssignedDriver(client, userId(req), assignedDriver);
    if (!authorized) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can start this trip.');
    }
    const currentStatus = x.reservation_status || x.status;
    if (!['approved', 'dispatched'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'INVALID_STATUS', 'Trip is not ready to start.');
    }
    await client.query(`UPDATE trips SET start_odometer=$1 WHERE trip_id=$2`, [odo, x.trip_id]);
    await client.query(`UPDATE reservations SET status='active' WHERE reservation_id=$1`, [x.reservation_id]);
    if (latitude != null && longitude != null) {
      await client.query(`INSERT INTO location_pings(trip_id, latitude, longitude, recorded_at) VALUES($1, $2, $3, COALESCE($4, NOW()))`, [x.trip_id, latitude, longitude, timestamp || null]);
    }
    await client.query('COMMIT');
    await addTripHistory(x.trip_id, currentStatus, 'active', userId(req));
    await audit(userId(req), 'START_TRIP', 'trip', String(x.trip_id));
    return ok(res, { tripId: x.trip_id, status: 'active' }, 'Trip started');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return fail(res, 500, 'START_ERROR', 'Unable to start trip.');
  } finally {
    client.release();
  }
});

router.post('/:id/locations', requireAuth, allowRoles('driver'), async (req, res) => {
  const { latitude, longitude, timestamp, accuracyMeters, speedKmh } = req.body;
  if (latitude == null || longitude == null || !timestamp) {
    return fail(res, 400, 'VALIDATION_ERROR', 'latitude, longitude and timestamp are required.');
  }
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const currentStatus = x.reservation_status || x.status;
    if (currentStatus !== 'active') {
      return fail(res, 409, 'INVALID_STATUS', 'Locations are accepted only for active trips.');
    }
    const assignedDriver = x.driver_id ?? x.res_driver_id;
    const authorized = await isAssignedDriver(pool, userId(req), assignedDriver);
    if (!authorized) {
      return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can send location.');
    }
    const t = new Date(timestamp);
    if (Number.isNaN(t.getTime()) || t.getTime() > Date.now() + 5 * 60 * 1000) {
      return fail(res, 400, 'INVALID_TIMESTAMP', 'Location timestamp is invalid or in the future.');
    }
    if (Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) {
      return fail(res, 400, 'INVALID_COORDINATES', 'Coordinates are invalid.');
    }
    const last = await pool.query(
      `SELECT latitude, longitude, recorded_at FROM location_pings WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [x.trip_id]
    );
    if (last.rows[0]) {
      const dt = Math.max(0.001, (t - new Date(last.rows[0].recorded_at)) / 3600000);
      const km = Math.sqrt((Number(latitude) - Number(last.rows[0].latitude)) ** 2 + (Number(longitude) - Number(last.rows[0].longitude)) ** 2) * 111;
      if (km / dt > 180) {
        return fail(res, 400, 'IMPOSSIBLE_LOCATION_JUMP', 'Location jump is not plausible.');
      }
    }
    const p = await pool.query(
      `INSERT INTO location_pings(trip_id, latitude, longitude, recorded_at, accuracy_meters, speed_kmh) VALUES($1, $2, $3, $4, $5, $6) RETURNING *`,
      [x.trip_id, latitude, longitude, t, accuracyMeters || null, speedKmh || null]
    );
    return ok(res, formatLocationPing(p.rows[0]), 'Location recorded', 201);
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'LOCATION_ERROR', 'Unable to record location.');
  }
});

router.get('/:id/location/latest', requireAuth, async (req, res) => {
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const r = await pool.query(
      `SELECT * FROM location_pings WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [x.trip_id]
    );
    return ok(res, formatLocationPing(r.rows[0]) || null);
  } catch (e) {
    return fail(res, 500, 'LOCATION_ERROR', 'Unable to get latest location.');
  }
});

router.get('/:id/passengers', requireAuth, async (req, res) => {
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');

    const userRole = normalizeRole(req.user?.role);
    const sub = userId(req);

    let isAuthorized = false;
    if (['fleet_admin', 'dispatcher'].includes(userRole)) {
      isAuthorized = true;
    } else if (userRole === 'driver') {
      const assignedDriver = x.driver_id ?? x.res_driver_id;
      isAuthorized = await isAssignedDriver(pool, sub, assignedDriver);
    } else if (userRole === 'requester') {
      isAuthorized = sub != null && String(sub) === String(x.requester_id);
    } else {
      if (sub != null && String(sub) === String(x.requester_id)) {
        isAuthorized = true;
      } else {
        const assignedDriver = x.driver_id ?? x.res_driver_id;
        isAuthorized = await isAssignedDriver(pool, sub, assignedDriver);
      }
    }

    if (!isAuthorized) {
      return fail(res, 403, 'FORBIDDEN', 'You do not have permission to view passengers for this trip.');
    }

    let reqName = null;
    let reqEmail = null;
    if (x.requester_id) {
      const reqInfo = await pool.query(
        `SELECT u.name, c.email FROM users u LEFT JOIN fleet_api_credentials c ON c.user_id = CAST(u.user_id AS TEXT) WHERE u.user_id = $1`,
        [x.requester_id]
      );
      if (reqInfo.rows[0]) {
        reqName = reqInfo.rows[0].name || null;
        reqEmail = reqInfo.rows[0].email || null;
      }
    }

    const count = x.passengers == null ? 0 : Number(x.passengers);
    const requesterData = x.requester_id == null ? null : {
      id: String(x.requester_id),
      name: reqName,
      email: reqEmail
    };

    return ok(res, {
      tripId: Number(x.trip_id),
      reservationId: x.reservation_id,
      passengersCount: count,
      requester: requesterData,
      passengers: []
    });
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'PASSENGERS_ERROR', 'Unable to get trip passengers.');
  }
});

router.get('/:id/locations', requireAuth, async (req, res) => {
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const vals = [x.trip_id];
    let where = 'trip_id = $1';
    if (req.query.from) {
      vals.push(req.query.from);
      where += ` AND recorded_at >= $${vals.length}`;
    }
    if (req.query.to) {
      vals.push(req.query.to);
      where += ` AND recorded_at <= $${vals.length}`;
    }
    const r = await pool.query(`SELECT * FROM location_pings WHERE ${where} ORDER BY recorded_at`, vals);
    return ok(res, r.rows.map(formatLocationPing));
  } catch (e) {
    return fail(res, 500, 'LOCATION_ERROR', 'Unable to get location history.');
  }
});

router.post('/:id/complete', requireAuth, allowRoles('driver'), async (req, res) => {
  const b = req.body;
  const end = b.odometerEnd ?? b.end_odometer;
  const dist = b.actualDistanceKm ?? b.actual_distance_km;
  const fuel = b.actualFuelLiters ?? b.actual_fuel_used_liters;
  if (end == null || dist == null || fuel == null) {
    return fail(res, 400, 'VALIDATION_ERROR', 'odometerEnd, actualDistanceKm and actualFuelLiters are required.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = await findTrip(client, req.params.id, true);
    if (!x) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }
    const currentStatus = x.reservation_status || x.status;
    if (currentStatus !== 'active') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'INVALID_STATUS', 'Only active trips can be completed.');
    }
    const assignedDriver = x.driver_id ?? x.res_driver_id;
    const authorized = await isAssignedDriver(client, userId(req), assignedDriver);
    if (!authorized) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can complete this trip.');
    }
    if (Number(end) < Number(x.start_odometer || 0)) {
      await client.query('ROLLBACK');
      return fail(res, 400, 'INVALID_ODOMETER', 'End odometer cannot be lower than start odometer.');
    }

    await client.query(`UPDATE trips SET end_odometer=$1, actual_distance_km=$2, actual_fuel_used_liters=$3 WHERE trip_id=$4`, [end, dist, fuel, x.trip_id]);
    await client.query(`UPDATE reservations SET status='completed', actual_fuel_liters=$1, trip_end_timestamp=NOW() WHERE reservation_id=$2`, [fuel, x.reservation_id]);
    if (x.vehicle_id) {
      await client.query(`UPDATE vehicles SET current_odometer=GREATEST(COALESCE(current_odometer, 0), $1) WHERE vehicle_id=$2`, [end, x.vehicle_id]);
    }
    await client.query('COMMIT');
    await addTripHistory(x.trip_id, 'active', 'completed', userId(req), b.notes);
    await audit(userId(req), 'COMPLETE_TRIP', 'trip', String(x.trip_id), { actualDistanceKm: dist, actualFuelLiters: fuel });
    await notify(x.requester_id, 'Trip completed', 'Your trip has been completed.');
    return ok(res, { tripId: x.trip_id, status: 'completed' }, 'Trip completed');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return fail(res, 500, 'COMPLETE_ERROR', 'Unable to complete trip.');
  } finally {
    client.release();
  }
});

router.get('/:id/fuel', requireAuth, async (req, res) => {
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const r = await pool.query(`SELECT * FROM fuel_transactions WHERE trip_id = $1 ORDER BY recorded_at`, [x.trip_id]);
    return ok(res, r.rows);
  } catch (e) {
    return fail(res, 500, 'FUEL_ERROR', 'Unable to get trip fuel transactions.');
  }
});

router.post('/:id/fuel', requireAuth, allowRoles('driver', 'dispatcher', 'fleet_admin'), async (req, res) => {
  const b = req.body;
  if (b.liters == null || b.cost == null) {
    return fail(res, 400, 'VALIDATION_ERROR', 'liters and cost are required.');
  }
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const userRole = normalizeRole(req.user?.role);
    if (userRole === 'driver') {
      const assignedDriver = x.driver_id ?? x.res_driver_id;
      const authorized = await isAssignedDriver(pool, userId(req), assignedDriver);
      if (!authorized) {
        return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can log fuel for this trip.');
      }
    }
    const r = await pool.query(
      `INSERT INTO fuel_transactions(trip_id, liters, cost, odometer, recorded_at) VALUES($1, $2, $3, $4, COALESCE($5, NOW())) RETURNING *`,
      [x.trip_id, b.liters, b.cost, b.odometer || null, b.timestamp || null]
    );
    return ok(res, r.rows[0], 'Fuel transaction added', 201);
  } catch (e) {
    return fail(res, 400, 'FUEL_TRANSACTION_ERROR', 'Unable to add fuel transaction.');
  }
});

router.patch('/:id/status', requireAuth, allowRoles('driver', 'dispatcher', 'fleet_admin'), async (req, res) => {
  const rawStatus = req.body?.status;
  if (!rawStatus || typeof rawStatus !== 'string') {
    return fail(res, 400, 'INVALID_STATUS', 'status is required.');
  }

  const normStatus = rawStatus.trim().toLowerCase();
  const allowedStatuses = ['dispatched', 'active', 'started', 'completed', 'cancelled'];
  if (!allowedStatuses.includes(normStatus)) {
    return fail(res, 400, 'INVALID_STATUS', 'Invalid trip status.');
  }

  const targetStatus = normStatus === 'started' ? 'active' : normStatus;
  const userRole = normalizeRole(req.user?.role);

  if (targetStatus === 'dispatched') {
    if (!['dispatcher', 'fleet_admin'].includes(userRole)) {
      return fail(res, 403, 'FORBIDDEN', 'You do not have permission for this operation.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const x = await findTrip(client, req.params.id, true);
      if (!x) {
        await client.query('ROLLBACK');
        return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      const currentStatus = x.reservation_status || x.status;
      if (currentStatus !== 'approved') {
        await client.query('ROLLBACK');
        return fail(res, 409, 'INVALID_STATUS', 'Trip must be approved before dispatch.');
      }
      await client.query(`UPDATE reservations SET status='dispatched' WHERE reservation_id=$1`, [x.reservation_id]);
      await client.query('COMMIT');
      await addTripHistory(x.trip_id, 'approved', 'dispatched', userId(req), req.body?.reason);
      await audit(userId(req), 'DISPATCH_TRIP', 'trip', String(x.trip_id));
      return ok(res, { tripId: x.trip_id, status: 'dispatched' }, 'Trip dispatched');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      return fail(res, 500, 'DISPATCH_ERROR', 'Unable to dispatch trip.');
    } finally {
      client.release();
    }
  }

  if (targetStatus === 'active') {
    const odo = req.body.odometerStart ?? req.body.odometer_start;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const x = await findTrip(client, req.params.id, true);
      if (!x) {
        await client.query('ROLLBACK');
        return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      if (userRole === 'driver') {
        const assignedDriver = x.driver_id ?? x.res_driver_id;
        const authorized = await isAssignedDriver(client, userId(req), assignedDriver);
        if (!authorized) {
          await client.query('ROLLBACK');
          return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can start this trip.');
        }
      }
      const currentStatus = x.reservation_status || x.status;
      if (!['approved', 'dispatched'].includes(currentStatus)) {
        await client.query('ROLLBACK');
        return fail(res, 409, 'INVALID_STATUS', 'Trip is not ready to start.');
      }

      let startOdo = odo;
      if (startOdo == null) {
        if (x.start_odometer != null) {
          startOdo = x.start_odometer;
        } else if (x.vehicle_id) {
          const v = await client.query(`SELECT current_odometer FROM vehicles WHERE vehicle_id=$1`, [x.vehicle_id]);
          startOdo = Number(v.rows[0]?.current_odometer || 0);
        } else {
          startOdo = 0;
        }
      }

      await client.query(`UPDATE trips SET start_odometer=$1 WHERE trip_id=$2`, [startOdo, x.trip_id]);
      await client.query(`UPDATE reservations SET status='active' WHERE reservation_id=$1`, [x.reservation_id]);
      if (req.body.latitude != null && req.body.longitude != null) {
        await client.query(`INSERT INTO location_pings(trip_id, latitude, longitude, recorded_at) VALUES($1, $2, $3, COALESCE($4, NOW()))`, [x.trip_id, req.body.latitude, req.body.longitude, req.body.timestamp || null]);
      }
      await client.query('COMMIT');
      await addTripHistory(x.trip_id, currentStatus, 'active', userId(req));
      await audit(userId(req), 'START_TRIP', 'trip', String(x.trip_id));
      return ok(res, { tripId: x.trip_id, status: 'active' }, 'Trip started');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      return fail(res, 500, 'START_ERROR', 'Unable to start trip.');
    } finally {
      client.release();
    }
  }

  if (targetStatus === 'completed') {
    const b = req.body;
    const end = b.odometerEnd ?? b.end_odometer;
    const dist = b.actualDistanceKm ?? b.actual_distance_km;
    const fuel = b.actualFuelLiters ?? b.actual_fuel_used_liters;

    if (end == null || dist == null || fuel == null) {
      return fail(res, 400, 'VALIDATION_ERROR', 'odometerEnd, actualDistanceKm and actualFuelLiters are required.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const x = await findTrip(client, req.params.id, true);
      if (!x) {
        await client.query('ROLLBACK');
        return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      if (userRole === 'driver') {
        const assignedDriver = x.driver_id ?? x.res_driver_id;
        const authorized = await isAssignedDriver(client, userId(req), assignedDriver);
        if (!authorized) {
          await client.query('ROLLBACK');
          return fail(res, 403, 'FORBIDDEN', 'Only the assigned driver can complete this trip.');
        }
      }
      const currentStatus = x.reservation_status || x.status;
      if (currentStatus !== 'active') {
        await client.query('ROLLBACK');
        return fail(res, 409, 'INVALID_STATUS', 'Only active trips can be completed.');
      }
      if (Number(end) < Number(x.start_odometer || 0)) {
        await client.query('ROLLBACK');
        return fail(res, 400, 'INVALID_ODOMETER', 'End odometer cannot be lower than start odometer.');
      }

      await client.query(`UPDATE trips SET end_odometer=$1, actual_distance_km=$2, actual_fuel_used_liters=$3 WHERE trip_id=$4`, [end, dist, fuel, x.trip_id]);
      await client.query(`UPDATE reservations SET status='completed', actual_fuel_liters=$1, trip_end_timestamp=NOW() WHERE reservation_id=$2`, [fuel, x.reservation_id]);
      if (x.vehicle_id) {
        await client.query(`UPDATE vehicles SET current_odometer=GREATEST(COALESCE(current_odometer, 0), $1) WHERE vehicle_id=$2`, [end, x.vehicle_id]);
      }
      await client.query('COMMIT');
      await addTripHistory(x.trip_id, 'active', 'completed', userId(req), b.notes);
      await audit(userId(req), 'COMPLETE_TRIP', 'trip', String(x.trip_id), { actualDistanceKm: dist, actualFuelLiters: fuel });
      await notify(x.requester_id, 'Trip completed', 'Your trip has been completed.');
      return ok(res, { tripId: x.trip_id, status: 'completed' }, 'Trip completed');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      return fail(res, 500, 'COMPLETE_ERROR', 'Unable to complete trip.');
    } finally {
      client.release();
    }
  }

  if (targetStatus === 'cancelled') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const x = await findTrip(client, req.params.id, true);
      if (!x) {
        await client.query('ROLLBACK');
        return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      const old = x.reservation_status || x.status;
      await client.query(`UPDATE reservations SET status='cancelled', rejection_reason=$1 WHERE reservation_id=$2`, [req.body?.reason || 'Cancelled', x.reservation_id]);
      await client.query('COMMIT');
      await addTripHistory(x.trip_id, old, 'cancelled', userId(req), req.body?.reason);
      await audit(userId(req), 'CANCEL_TRIP', 'trip', String(x.trip_id));
      return ok(res, { tripId: x.trip_id, status: 'cancelled' }, 'Trip cancelled');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      return fail(res, 500, 'CANCEL_ERROR', 'Unable to cancel trip.');
    } finally {
      client.release();
    }
  }
});

router.get('/:id/status-history', requireAuth, async (req, res) => {
  try {
    const x = await findTrip(pool, req.params.id);
    if (!x) return fail(res, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    const r = await pool.query(`SELECT * FROM trip_status_history WHERE trip_id = $1 ORDER BY changed_at`, [x.trip_id]);
    return ok(res, r.rows);
  } catch (e) {
    return fail(res, 500, 'HISTORY_ERROR', 'Unable to get trip status history.');
  }
});

module.exports = router;
