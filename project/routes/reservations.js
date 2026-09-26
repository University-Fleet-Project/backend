const express=require('express'); const {pool}=require('../config/db'); const {ok,fail,pagination,paged,audit,notify,addReservationHistory,userId,checkVehicleAvailability}=require('../utils'); const {requireAuth,allowRoles}=require('../middleware/auth');
const router=express.Router();

function bodyValue(b,a,c){return b[a]!==undefined?b[a]:b[c];}
async function ensureReservationEstimates(clientOrPool, r) {
  if (!r || !r.reservation_id) return;
  const resId = String(r.reservation_id);

  try {
    if (r.route_km != null) {
      let originObj = r.origin;
      if (typeof originObj === 'string') {
        try { originObj = JSON.parse(originObj); } catch { originObj = { name: r.origin }; }
      }
      let destObj = r.destination;
      if (typeof destObj === 'string') {
        try { destObj = JSON.parse(destObj); } catch { destObj = { name: r.destination }; }
      }

      const dist = Number(r.route_km);
      const durationMins = (dist > 0) ? Math.round(dist / 40 * 60) : null;

      await clientOrPool.query(
        `INSERT INTO route_estimates (reservation_id, origin, destination, distance_km, duration_minutes, provider, snapshot)
         SELECT CAST($1 AS VARCHAR), $2::jsonb, $3::jsonb, $4::numeric, $5::numeric, 'mock', '{"method": "haversine*1.2"}'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM route_estimates WHERE reservation_id = CAST($1 AS VARCHAR))`,
        [resId, JSON.stringify(originObj), JSON.stringify(destObj), dist, durationMins]
      );
    }

    if (r.estimated_fuel_liters != null) {
      const estLiters = Number(r.estimated_fuel_liters);
      const price = Number(r.fuel_price || 15);
      const estCost = estLiters * price;
      const minLiters = estLiters * 0.88;
      const maxLiters = estLiters * 1.18;
      const assumptions = ['Derived from reservation data'];

      await clientOrPool.query(
        `INSERT INTO fuel_estimates (reservation_id, vehicle_id, route_distance_km, estimated_liters, estimated_cost, method, min_liters, max_liters, confidence, assumptions, fallback_used)
         SELECT CAST($1 AS VARCHAR), $2, $3::numeric, $4::numeric, $5::numeric, 'baseline', $6::numeric, $7::numeric, 0.72, $8::jsonb, true
         WHERE NOT EXISTS (SELECT 1 FROM fuel_estimates WHERE reservation_id = CAST($1 AS VARCHAR))`,
        [resId, r.vehicle_id, r.route_km != null ? Number(r.route_km) : 0, estLiters, estCost, minLiters, maxLiters, JSON.stringify(assumptions)]
      );
    }
  } catch (e) {
    console.error('Error ensuring reservation estimates:', e);
  }
}

async function fetchReservationEstimates(clientOrPool, reservationId, reservationRow = null) {
  let route_estimate = null;
  let fuel_estimate = null;
  try {
    let routeRes = await clientOrPool.query(
      `SELECT * FROM route_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [reservationId]
    );
    let fuelRes = await clientOrPool.query(
      `SELECT * FROM fuel_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [reservationId]
    );

    if ((!routeRes.rows[0] || !fuelRes.rows[0]) && reservationRow) {
      await ensureReservationEstimates(clientOrPool, reservationRow);
      if (!routeRes.rows[0]) {
        routeRes = await clientOrPool.query(
          `SELECT * FROM route_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [reservationId]
        );
      }
      if (!fuelRes.rows[0]) {
        fuelRes = await clientOrPool.query(
          `SELECT * FROM fuel_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [reservationId]
        );
      }
    }

    if (routeRes.rows[0]) {
      const re = routeRes.rows[0];
      let durationMins = re.duration_minutes != null ? Number(re.duration_minutes) : null;
      if (durationMins == null && re.distance_km != null && Number(re.distance_km) > 0) {
        durationMins = Math.round(Number(re.distance_km) / 40 * 60);
        try {
          await clientOrPool.query(
            `UPDATE route_estimates SET duration_minutes = $1 WHERE route_id = $2 AND duration_minutes IS NULL`,
            [durationMins, re.route_id]
          );
        } catch (uErr) {
          console.error('Error updating duration_minutes on route_estimates:', uErr);
        }
      }
      route_estimate = {
        distance_km: re.distance_km != null ? Number(Number(re.distance_km).toFixed(2)) : null,
        duration_minutes: durationMins,
        provider: re.provider || 'mock'
      };
    }

    if (fuelRes.rows[0]) {
      const fe = fuelRes.rows[0];
      fuel_estimate = {
        estimated_liters: fe.estimated_liters != null ? Number(Number(fe.estimated_liters).toFixed(2)) : null,
        estimated_cost: fe.estimated_cost != null ? Number(Number(fe.estimated_cost).toFixed(2)) : null,
        min_liters: fe.min_liters != null ? Number(Number(fe.min_liters).toFixed(2)) : null,
        max_liters: fe.max_liters != null ? Number(Number(fe.max_liters).toFixed(2)) : null,
        method: fe.method || 'baseline',
        confidence: fe.confidence != null ? Number(fe.confidence) : 0.72,
        assumptions: fe.assumptions || null,
        fallback_used: fe.fallback_used ?? true
      };
    }
  } catch (e) {
    console.error('Error fetching reservation estimates:', e);
  }
  return { route_estimate, fuel_estimate };
}

function formatReservation(r) {
  if (!r) return r;
  const numericTripId = r.trip_id != null ? Number(r.trip_id) : null;
  const qr = r.reservation_id ? `FLT-QR-${r.reservation_id}` : null;
  const totalCap = r.seats != null ? Number(r.seats) : (r.totalCapacity != null ? Number(r.totalCapacity) : null);
  const availSeats = r.available_seats != null ? Number(r.available_seats) : (r.availableSeats != null ? Number(r.availableSeats) : null);
  return {
    ...r,
    tripType: r.trip_type ?? null,
    tripId: numericTripId,
    trip_id: numericTripId,
    qr_code: qr,
    qrCode: qr,
    totalCapacity: totalCap,
    capacity: totalCap,
    available_seats: availSeats,
    availableSeats: availSeats,
    startTime: r.trip_start_timestamp ?? r.startTime ?? null,
    endTime: r.trip_end_timestamp ?? r.endTime ?? null
  };
}

 router.post('/',requireAuth,async(req,res)=>{
 const b=req.body; const requesterId=userId(req)||bodyValue(b,'requesterId','requester_id'); const vehicleId=bodyValue(b,'vehicleId','vehicle_id');
 const start=bodyValue(b,'startTime','start_time'); let end=bodyValue(b,'endTime','end_time');
 const origin=typeof b.origin==='object'?JSON.stringify(b.origin):b.origin, destination=typeof b.destination==='object'?JSON.stringify(b.destination):b.destination;
 const distance=bodyValue(b,'distanceKm','distance_km');
 const durMins=bodyValue(b,'durationMinutes','duration_minutes')??b.duration;

 if(!requesterId||!vehicleId||!start||!origin||!destination||b.passengers==null||(b.distanceKm==null&&b.distance_km==null))return fail(res,400,'VALIDATION_ERROR','vehicleId, startTime, origin, destination, passengers and distanceKm are required.');

 const rawTripType = bodyValue(b, 'tripType', 'trip_type');
 let tripTypeToSave = null;
 if (rawTripType != null && String(rawTripType).trim() !== '') {
   const tt = String(rawTripType).trim().toLowerCase();
   if (tt !== 'local' && tt !== 'intercity') {
     return fail(res, 400, 'INVALID_TRIP_TYPE', 'tripType must be local or intercity.');
   }
   tripTypeToSave = tt;
 }

 const comment=b.comment??b.notes??null;
 const client=await pool.connect();
 try{
   await client.query('BEGIN');
   await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[String(vehicleId)]);
   const avail=await checkVehicleAvailability(client,vehicleId,start,end,{ requestedPassengers: b.passengers, distanceKm: distance, durationMinutes: durMins });
   if(!avail.available){
     await client.query('ROLLBACK');
     if(avail.code==='VEHICLE_NOT_FOUND')return fail(res,404,'VEHICLE_NOT_FOUND',avail.message);
     if(avail.code==='INVALID_TIMEFRAME')return fail(res,400,'INVALID_TIMEFRAME',avail.message);
     if(avail.code==='PASSENGER_CAPACITY_EXCEEDED')return fail(res,400,'PASSENGER_CAPACITY_EXCEEDED',avail.message);
     if(avail.code==='CAPACITY_EXCEEDED')return fail(res,409,'CAPACITY_EXCEEDED',avail.message,{ totalCapacity: avail.totalCapacity, bookedPassengers: avail.bookedPassengers, availableSeats: avail.availableSeats, requestedPassengers: avail.requestedPassengers });
     return fail(res,409,avail.code||'VEHICLE_NOT_AVAILABLE',avail.message);
   }
   const v=avail.vehicle;
   if(b.load!=null && v.allowed_load_kg!=null && Number(b.load)>Number(v.allowed_load_kg)){await client.query('ROLLBACK');return fail(res,400,'LOAD_CAPACITY_EXCEEDED','Load exceeds vehicle capacity.');}
   const nominal=Number(v.nominal_l_per_100km||0), est=Number(distance)*nominal/100;
   const id='FLT-RES-'+Date.now();
   const r=await client.query(`INSERT INTO reservations(reservation_id,vehicle_id,vehicle_type,request_timestamp,trip_start_timestamp,trip_end_timestamp,status,origin,destination,route_km,estimated_fuel_liters,passengers,load_kg,requester_id,comment,trip_type) VALUES($1,$2,$3,NOW(),$4::timestamp,$5::timestamp,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[id,vehicleId,v.vehicle_type,avail.startTime,avail.endTime,origin,destination,distance,est,b.passengers,b.load??b.load_kg??0,requesterId,comment,tripTypeToSave]);

   let durationMinutes = bodyValue(b, 'durationMinutes', 'duration_minutes') ?? b.duration ?? null;
   if (durationMinutes == null && (b.routeEstimateId || b.route_estimate_id)) {
     const estId = b.routeEstimateId || b.route_estimate_id;
     try {
       const reQuery = await client.query(`SELECT duration_minutes FROM route_estimates WHERE route_id = $1`, [estId]);
       if (reQuery.rows[0] && reQuery.rows[0].duration_minutes != null) {
         durationMinutes = Number(reQuery.rows[0].duration_minutes);
       }
     } catch (e) {}
   }
   if (durationMinutes == null && distance != null && !isNaN(Number(distance)) && Number(distance) > 0) {
     try {
       const reQuery = await client.query(
         `SELECT duration_minutes FROM route_estimates WHERE reservation_id IS NULL AND distance_km = $1 AND duration_minutes IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
         [Number(distance)]
       );
       if (reQuery.rows[0] && reQuery.rows[0].duration_minutes != null) {
         durationMinutes = Number(reQuery.rows[0].duration_minutes);
       } else {
         durationMinutes = Math.round(Number(distance) / 40 * 60);
       }
     } catch (e) {
       durationMinutes = Math.round(Number(distance) / 40 * 60);
     }
   }

   const fuelPrice = Number(process.env.FUEL_PRICE_EGP || 15);
   const estCost = b.estimatedCost ?? b.estimated_cost ?? (est * fuelPrice);
   const minLit = b.minLiters ?? b.min_liters ?? (est * 0.88);
   const maxLit = b.maxLiters ?? b.max_liters ?? (est * 1.18);
   const method = b.method || 'baseline';
   const confidence = b.confidence != null ? Number(b.confidence) : 0.72;
   const assumptions = b.assumptions ? (typeof b.assumptions === 'string' ? JSON.parse(b.assumptions) : b.assumptions) : [`Nominal consumption: ${nominal} L/100km`, 'medium traffic', 'AC disabled'];
   const fallbackUsed = b.fallbackUsed ?? b.fallback_used ?? true;

   let originObj = b.origin;
   if (typeof originObj === 'string') {
     try { originObj = JSON.parse(originObj); } catch { originObj = { name: b.origin }; }
   }
   let destObj = b.destination;
   if (typeof destObj === 'string') {
     try { destObj = JSON.parse(destObj); } catch { destObj = { name: b.destination }; }
   }

   try {
     await client.query(
       `INSERT INTO route_estimates(reservation_id,origin,destination,distance_km,duration_minutes,provider,snapshot) VALUES(CAST($1 AS VARCHAR),$2::jsonb,$3::jsonb,$4,$5,$6,$7::jsonb)`,
       [id, JSON.stringify(originObj), JSON.stringify(destObj), distance, durationMinutes, b.provider || 'mock', JSON.stringify(b.snapshot || { method: 'haversine*1.2' })]
     );
     await client.query(
       `INSERT INTO fuel_estimates(reservation_id,vehicle_id,route_distance_km,estimated_liters,estimated_cost,method,min_liters,max_liters,confidence,assumptions,fallback_used) VALUES(CAST($1 AS VARCHAR),$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
       [id, vehicleId, distance, est, estCost, method, minLit, maxLit, confidence, JSON.stringify(assumptions), fallbackUsed]
     );
   } catch (estErr) {
     console.error('Error creating route/fuel estimates:', estErr);
   }

   await client.query('COMMIT');
   await addReservationHistory(id,null,'pending',requesterId,'Reservation created'); await audit(requesterId,'CREATE_RESERVATION','reservation',id);
   const estimates = await fetchReservationEstimates(pool, id, r.rows[0]);
   return ok(res, formatReservation({ ...r.rows[0], ...estimates }),'Reservation created',201);
 }catch(e){try{await client.query('ROLLBACK')}catch{};console.error(e);return fail(res,400,'CREATE_RESERVATION_ERROR',e.message);}finally{client.release();}
});
router.get('/my',requireAuth,async(req,res)=>{
  const {status,from,to,tripType,trip_type}=req.query;
  const rawTT = tripType || trip_type;
  if (rawTT) {
    const tt = String(rawTT).trim().toLowerCase();
    if (tt !== 'local' && tt !== 'intercity') {
      return fail(res, 400, 'INVALID_TRIP_TYPE', 'tripType must be local or intercity.');
    }
  }
  const {page,limit,offset}=pagination(req);
  const vals=[userId(req)];
  const w=['requester_id=$1'];
  if(status){vals.push(status);w.push(`status=$${vals.length}`);}
  if(from){vals.push(from);w.push(`trip_start_timestamp>=$${vals.length}`);}
  if(to){vals.push(to);w.push(`trip_end_timestamp<=$${vals.length}`);}
  if(rawTT){vals.push(String(rawTT).trim().toLowerCase());w.push(`trip_type=$${vals.length}`);}
  try{
    const c=await pool.query(`SELECT COUNT(*)::int total FROM reservations WHERE ${w.join(' AND ')}`,vals);
    const r=await pool.query(`SELECT r.*, (SELECT t.trip_id FROM trips t WHERE t.reservation_id = r.reservation_id ORDER BY t.trip_id DESC LIMIT 1) AS trip_id FROM reservations r WHERE ${w.join(' AND ')} ORDER BY request_timestamp DESC LIMIT ${limit} OFFSET ${offset}`,vals);
    const items = r.rows.map(formatReservation);
    return paged(res,items,c.rows[0].total,page,limit);
  }catch(e){return fail(res,500,'RESERVATIONS_ERROR','Unable to list reservations.');}
});
router.get('/',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{
  const {tripType,trip_type}=req.query;
  const rawTT = tripType || trip_type;
  const vals = [];
  const w = [];
  if (rawTT) {
    const tt = String(rawTT).trim().toLowerCase();
    if (tt !== 'local' && tt !== 'intercity') {
      return fail(res, 400, 'INVALID_TRIP_TYPE', 'tripType must be local or intercity.');
    }
    vals.push(tt);
    w.push(`trip_type=$${vals.length}`);
  }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  try{
    const r=await pool.query(`SELECT r.*, (SELECT t.trip_id FROM trips t WHERE t.reservation_id = r.reservation_id ORDER BY t.trip_id DESC LIMIT 1) AS trip_id FROM reservations r ${where} ORDER BY request_timestamp DESC`, vals);
    const items = r.rows.map(formatReservation);
    return ok(res,items);
  }catch(e){return fail(res,500,'RESERVATIONS_ERROR','Unable to list reservations.');}
});
router.get('/:id',requireAuth,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT r.*, (SELECT t.trip_id FROM trips t WHERE t.reservation_id = r.reservation_id ORDER BY t.trip_id DESC LIMIT 1) AS trip_id FROM reservations r WHERE reservation_id=$1`,[req.params.id]);
    if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');
    const estimates=await fetchReservationEstimates(pool,req.params.id,r.rows[0]);
    return ok(res, formatReservation({...r.rows[0],...estimates}));
  }catch(e){return fail(res,500,'RESERVATION_ERROR','Unable to get reservation.');}
});
router.post('/:id/cancel',requireAuth,async(req,res)=>{const reason=req.body.reason||'Cancelled by requester';try{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');if(String(r.rows[0].requester_id)!==String(userId(req))&&!['dispatcher','fleet_admin'].includes(req.user.role))return fail(res,403,'FORBIDDEN','You cannot cancel this reservation.');const old=r.rows[0].status;await pool.query(`UPDATE reservations SET status='cancelled',rejection_reason=$1 WHERE reservation_id=$2`,[reason,req.params.id]);await addReservationHistory(req.params.id,old,'cancelled',userId(req),reason);await audit(userId(req),'CANCEL_RESERVATION','reservation',req.params.id,{reason});return ok(res,null,'Reservation cancelled');}catch(e){return fail(res,500,'CANCEL_ERROR','Unable to cancel reservation.');}});
router.get('/:id/status-history',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM reservation_status_history WHERE reservation_id=$1 ORDER BY changed_at`,[req.params.id]);return ok(res,r.rows);}catch(e){return fail(res,500,'HISTORY_ERROR','Unable to get reservation status history.');}});
router.get('/:id/qr',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT reservation_id, requester_id FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');const qr = `FLT-QR-${req.params.id}`;return ok(res,{reservationId:req.params.id,reservation_id:req.params.id,qrCode:qr,qr_code:qr});}catch(e){return fail(res,500,'QR_ERROR','Unable to get reservation QR code.');}});
module.exports=router;
