const { pool } = require('./config/db');

function ok(res, data, message='Success', status=200) {
  return res.status(status).json({ success:true, data, message });
}
function fail(res, status, code, message, details=null) {
  return res.status(status).json({ success:false, error:{code,message,details} });
}
function pagination(req) {
  const page = Math.max(1, Number.parseInt(req.query.page || '1',10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20',10)));
  return {page,limit,offset:(page-1)*limit};
}
function paged(res, items, total, page, limit) {
  return ok(res,{items,pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}});
}
function parseDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
async function audit(actorId, action, entityType, entityId, details={}) {
  await pool.query(
    `INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)`,
    [actorId==null?null:String(actorId),action,entityType,entityId==null?null:String(entityId),JSON.stringify(details)]
  );
}
async function notify(userId,title,message) {
  if (userId == null) return;
  await pool.query(`INSERT INTO notifications(user_id,title,message) VALUES($1,$2,$3)`,[String(userId),title,message]);
}
async function addReservationHistory(id, fromStatus, toStatus, changedBy, reason) {
  await pool.query(`INSERT INTO reservation_status_history(reservation_id,from_status,to_status,changed_by,reason) VALUES($1,$2,$3,$4,$5)`,[id,fromStatus,toStatus,changedBy?String(changedBy):null,reason||null]);
}
async function addTripHistory(id, fromStatus, toStatus, changedBy, reason) {
  await pool.query(`INSERT INTO trip_status_history(trip_id,from_status,to_status,changed_by,reason) VALUES($1,$2,$3,$4,$5)`,[id,fromStatus,toStatus,changedBy?String(changedBy):null,reason||null]);
}
function userId(req) { return req.user?.sub ?? req.body?.requesterId ?? req.body?.requester_id ?? null; }
async function checkVehicleAvailability(clientOrPool, vehicleId, startTime, endTime, options = {}) {
  const executor = clientOrPool || pool;

  const sDate = parseDate(startTime);
  if (!sDate) {
    return {
      available: false,
      code: 'INVALID_TIMEFRAME',
      message: 'startTime must be a valid ISO date.'
    };
  }

  const vId = String(vehicleId || '').trim();
  const vRes = await executor.query(
    `SELECT * FROM vehicles WHERE vehicle_id = $1 OR LOWER(vehicle_id) = LOWER($1) LIMIT 1`,
    [vId]
  );
  if (!vRes.rows[0]) {
    return {
      available: false,
      code: 'VEHICLE_NOT_FOUND',
      message: 'Vehicle not found.'
    };
  }

  const vehicle = vRes.rows[0];
  const canonicalVehicleId = vehicle.vehicle_id;
  const isBus = String(vehicle.vehicle_type || '').trim().toLowerCase() === 'bus';

  let eDate = endTime ? parseDate(endTime) : null;
  if (!eDate && isBus) {
    let durMins = options.durationMinutes ?? options.duration_minutes ?? options.duration;
    const distance = options.distanceKm ?? options.distance_km;
    if (durMins == null && distance != null && !isNaN(Number(distance)) && Number(distance) > 0) {
      durMins = Math.round((Number(distance) / 40) * 60);
    }
    if (durMins == null || isNaN(Number(durMins))) {
      durMins = 60;
    }
    eDate = new Date(sDate.getTime() + Number(durMins) * 60000);
  }

  if (!eDate || Number.isNaN(eDate.getTime()) || eDate <= sDate) {
    return {
      available: false,
      code: 'INVALID_TIMEFRAME',
      message: 'startTime and endTime must be valid ISO dates with startTime before endTime.'
    };
  }

  const startIso = sDate.toISOString();
  const endIso = eDate.toISOString();

  const serviceStatus = String(vehicle.service_status || '').trim().toLowerCase();
  const isOperable = ['available', 'active'].includes(serviceStatus);

  if (!isOperable) {
    return {
      available: false,
      code: 'VEHICLE_NOT_AVAILABLE',
      message: 'Vehicle is not currently available.',
      serviceStatus,
      isOperable,
      vehicle,
      conflicts: [],
      maintenanceConflicts: [],
      reservationConflicts: [],
      startTime: startIso,
      endTime: endIso
    };
  }

  const maintRes = await executor.query(
    `SELECT maintenance_id AS id, maintenance_id, start_at AS start, end_at AS "end", 'maintenance' AS status
     FROM maintenance_records
     WHERE vehicle_id = $1
       AND status <> 'completed'
       AND start_at < $3::timestamp
       AND end_at > $2::timestamp`,
    [canonicalVehicleId, startIso, endIso]
  );

  const excludeResClause = options.excludeReservationId ? ' AND reservation_id <> $4' : '';
  const resParams = options.excludeReservationId
    ? [canonicalVehicleId, startIso, endIso, options.excludeReservationId]
    : [canonicalVehicleId, startIso, endIso];

  const resRes = await executor.query(
    `SELECT reservation_id AS id, reservation_id, trip_start_timestamp AS start, trip_end_timestamp AS "end", status
     FROM reservations
     WHERE vehicle_id = $1
       AND status IN ('pending', 'approved', 'dispatched', 'active')
       AND trip_start_timestamp < $3::timestamp
       AND trip_end_timestamp > $2::timestamp
       ${excludeResClause}`,
    resParams
  );

  const maintenanceConflicts = maintRes.rows;
  const reservationConflicts = resRes.rows;
  const conflicts = [...reservationConflicts, ...maintenanceConflicts];

  if (maintenanceConflicts.length > 0) {
    return {
      available: false,
      code: 'VEHICLE_NOT_AVAILABLE',
      message: 'Vehicle is under maintenance for the selected time.',
      serviceStatus,
      isOperable,
      vehicle,
      conflicts,
      maintenanceConflicts,
      reservationConflicts,
      startTime: startIso,
      endTime: endIso
    };
  }

  const requestedPassengers = options.requestedPassengers != null
    ? Number(options.requestedPassengers)
    : (options.passengers != null ? Number(options.passengers) : 0);
  const totalCapacity = Number(vehicle.seats || 0);

  if (isBus) {
    const excludeResClauseBus = options.excludeReservationId ? ' AND reservation_id <> $4' : '';
    const busParams = options.excludeReservationId
      ? [canonicalVehicleId, startIso, endIso, options.excludeReservationId]
      : [canonicalVehicleId, startIso, endIso];

    const bookedRes = await executor.query(
      `SELECT COALESCE(SUM(passengers), 0)::int AS booked_passengers
       FROM reservations
       WHERE vehicle_id = $1
         AND status IN ('pending', 'approved', 'dispatched', 'active')
         AND trip_start_timestamp < $3::timestamp
         AND trip_end_timestamp > $2::timestamp
         ${excludeResClauseBus}`,
      busParams
    );

    const bookedPassengers = Number(bookedRes.rows[0]?.booked_passengers || 0);
    const availableSeats = Math.max(0, totalCapacity - bookedPassengers);

    if (requestedPassengers > 0 && (bookedPassengers + requestedPassengers > totalCapacity)) {
      return {
        available: false,
        code: 'CAPACITY_EXCEEDED',
        message: 'Requested passengers exceed available capacity on this bus.',
        serviceStatus,
        isOperable,
        vehicle,
        totalCapacity,
        bookedPassengers,
        availableSeats,
        requestedPassengers,
        conflicts,
        maintenanceConflicts,
        reservationConflicts,
        startTime: startIso,
        endTime: endIso
      };
    }

    if (availableSeats <= 0) {
      return {
        available: false,
        code: 'CAPACITY_EXCEEDED',
        message: 'No seats available on this bus for the selected time.',
        serviceStatus,
        isOperable,
        vehicle,
        totalCapacity,
        bookedPassengers,
        availableSeats,
        requestedPassengers,
        conflicts,
        maintenanceConflicts,
        reservationConflicts,
        startTime: startIso,
        endTime: endIso
      };
    }

    return {
      available: true,
      code: 'AVAILABLE',
      message: 'Vehicle is available.',
      serviceStatus,
      isOperable,
      vehicle,
      totalCapacity,
      bookedPassengers,
      availableSeats,
      requestedPassengers,
      conflicts: [],
      maintenanceConflicts: [],
      reservationConflicts: [],
      startTime: startIso,
      endTime: endIso
    };
  }

  if (requestedPassengers > 0 && requestedPassengers > totalCapacity) {
    return {
      available: false,
      code: 'PASSENGER_CAPACITY_EXCEEDED',
      message: 'Passenger count exceeds vehicle capacity.',
      serviceStatus,
      isOperable,
      vehicle,
      totalCapacity,
      requestedPassengers,
      conflicts,
      maintenanceConflicts,
      reservationConflicts,
      startTime: startIso,
      endTime: endIso
    };
  }

  if (reservationConflicts.length > 0) {
    return {
      available: false,
      code: 'VEHICLE_NOT_AVAILABLE',
      message: 'Vehicle is already allocated for the selected time.',
      serviceStatus,
      isOperable,
      vehicle,
      totalCapacity,
      requestedPassengers,
      conflicts,
      maintenanceConflicts,
      reservationConflicts,
      startTime: startIso,
      endTime: endIso
    };
  }

  return {
    available: true,
    code: 'AVAILABLE',
    message: 'Vehicle is available.',
    serviceStatus,
    isOperable,
    vehicle,
    totalCapacity,
    requestedPassengers,
    conflicts: [],
    maintenanceConflicts: [],
    reservationConflicts: [],
    startTime: startIso,
    endTime: endIso
  };
}

module.exports={ok,fail,pagination,paged,parseDate,audit,notify,addReservationHistory,addTripHistory,userId,checkVehicleAvailability};
