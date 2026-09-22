const express=require('express'); const {pool}=require('../config/db'); const {ok,fail,pagination,paged,audit,notify,addReservationHistory,addTripHistory,userId}=require('../utils'); const {requireAuth,allowRoles}=require('../middleware/auth');
const router=express.Router();

router.get('/reservations',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{const {status='pending',date,vehicleType,search}=req.query;const {page,limit,offset}=pagination(req);const vals=[];const w=[];const add=(s,v)=>{vals.push(v);w.push(s.replace('?',`$${vals.length}`));};if(status)add(`r.status=?`,status);if(vehicleType)add(`r.vehicle_type ILIKE ?`,vehicleType);if(date)add(`DATE(r.trip_start_timestamp)=?`,date);if(search){vals.push(`%${search}%`);w.push(`(r.reservation_id ILIKE $${vals.length} OR r.origin ILIKE $${vals.length} OR r.destination ILIKE $${vals.length})`);}try{const where=w.length?`WHERE ${w.join(' AND ')}`:'';const c=await pool.query(`SELECT COUNT(*)::int total FROM reservations r ${where}`,vals);const r=await pool.query(`SELECT r.* FROM reservations r ${where} ORDER BY r.request_timestamp DESC LIMIT ${limit} OFFSET ${offset}`,vals);return paged(res,r.rows,c.rows[0].total,page,limit);}catch(e){return fail(res,500,'DISPATCHER_ERROR','Unable to list dispatcher reservations.');}});
async function fetchReservationEstimates(clientOrPool, reservationId) {
  let route_estimate = null;
  let fuel_estimate = null;
  try {
    const routeRes = await clientOrPool.query(
      `SELECT * FROM route_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [reservationId]
    );
    if (routeRes.rows[0]) {
      const re = routeRes.rows[0];
      route_estimate = {
        distance_km: re.distance_km != null ? Number(Number(re.distance_km).toFixed(2)) : null,
        duration_minutes: re.duration_minutes != null ? Number(re.duration_minutes) : null,
        provider: re.provider || 'mock'
      };
    }

    const fuelRes = await clientOrPool.query(
      `SELECT * FROM fuel_estimates WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [reservationId]
    );
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

router.get('/reservations/:id',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');const estimates=await fetchReservationEstimates(pool,req.params.id);return ok(res,{...r.rows[0],...estimates});});

router.post('/reservations/:id/approve',requireAuth,allowRoles('dispatcher','fleet_admin'),async(req,res)=>{
 const {vehicleId,driverId,reason}=req.body; if(!vehicleId||!driverId)return fail(res,400,'VALIDATION_ERROR','vehicleId and driverId are required.');
 const client=await pool.connect();
 try{
   await client.query('BEGIN');
   const rr=await client.query(`SELECT * FROM reservations WHERE reservation_id=$1 FOR UPDATE`,[req.params.id]); if(!rr.rows[0]){await client.query('ROLLBACK');return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');}
   const reservation=rr.rows[0]; if(!['pending','rejected'].includes(reservation.status)){await client.query('ROLLBACK');return fail(res,409,'INVALID_STATUS','Only pending reservations can be approved.');}
   await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[String(vehicleId)]);
   const v=await client.query(`SELECT * FROM vehicles WHERE vehicle_id=$1 FOR UPDATE`,[vehicleId]);if(!v.rows[0]){await client.query('ROLLBACK');return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');}
   const currentStatus=String(v.rows[0].service_status||'').trim().toLowerCase();
   if(!['available','active'].includes(currentStatus)){await client.query('ROLLBACK');return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is not available.');}
   if(Number(reservation.passengers||0)>Number(v.rows[0].seats||Infinity)){await client.query('ROLLBACK');return fail(res,400,'PASSENGER_CAPACITY_EXCEEDED','Passenger count exceeds vehicle capacity.');}
   if(reservation.load_kg!=null&&v.rows[0].allowed_load_kg!=null&&Number(reservation.load_kg)>Number(v.rows[0].allowed_load_kg)){await client.query('ROLLBACK');return fail(res,400,'LOAD_CAPACITY_EXCEEDED','Load exceeds vehicle capacity.');}
   const maintOverlap=await client.query(`SELECT maintenance_id FROM maintenance_records WHERE vehicle_id=$1 AND status<>'completed' AND start_at<$3 AND end_at>$2 LIMIT 1`,[vehicleId,reservation.trip_start_timestamp,reservation.trip_end_timestamp]);
   if(maintOverlap.rows[0]){await client.query('ROLLBACK');return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is under maintenance during the reservation window.');}
   const overlap=await client.query(`SELECT reservation_id FROM reservations WHERE vehicle_id=$1 AND status IN('approved','active') AND trip_start_timestamp<$3 AND trip_end_timestamp>$2 LIMIT 1`,[vehicleId,reservation.trip_start_timestamp,reservation.trip_end_timestamp]);
   if(overlap.rows[0]){await client.query('ROLLBACK');return fail(res,409,'VEHICLE_CONFLICT','Vehicle already allocated for an overlapping trip.',{conflictReservationId:overlap.rows[0].reservation_id});}
   const old=reservation.status;
   await client.query(`UPDATE reservations SET vehicle_id=$1,driver_id=$2,status='approved',approval_timestamp=NOW() WHERE reservation_id=$3`,[vehicleId,driverId,req.params.id]);
   let dr=await client.query(`SELECT driver_id FROM drivers WHERE CAST(driver_id AS TEXT)=$1 OR CAST(user_id AS TEXT)=$1 LIMIT 1`,[String(driverId)]);
   let effectiveDriverId=dr.rows[0]?.driver_id||(Number.isNaN(Number(driverId))?null:Number(driverId));
   let tripRes=await client.query(`SELECT trip_id FROM trips WHERE reservation_id=$1`,[req.params.id]);
   let tripId;
   if(tripRes.rows[0]){
     tripId=tripRes.rows[0].trip_id;
     await client.query(`UPDATE trips SET driver_id=$1 WHERE trip_id=$2`,[effectiveDriverId,tripId]);
   }else{
     let odo=Number(v.rows[0]?.current_odometer||0);
     let nt=await client.query(`INSERT INTO trips(reservation_id,driver_id,start_odometer,created_at) VALUES($1,$2,$3,NOW()) RETURNING trip_id`,[req.params.id,effectiveDriverId,odo]);
     tripId=nt.rows[0].trip_id;
   }
   await client.query('COMMIT');
   await addReservationHistory(req.params.id,old,'approved',userId(req),reason||'Approved after availability check');
   await audit(userId(req),'APPROVE_RESERVATION','reservation',req.params.id,{vehicleId,driverId});
   await notify(reservation.requester_id,'Reservation approved','Your reservation has been approved.');
   return ok(res,{reservationId:req.params.id,tripId:Number(tripId),vehicleId,driverId,status:'approved'},'Reservation approved');
 }catch(e){try{await client.query('ROLLBACK')}catch{};console.error(e);return fail(res,500,'APPROVAL_ERROR','Server error during approval.');}finally{client.release();}
});
router.post('/reservations/:id/reject',requireAuth,allowRoles('dispatcher','fleet_admin'),async(req,res)=>{const reason=req.body.reason||'Rejected';try{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');const old=r.rows[0].status;await pool.query(`UPDATE reservations SET status='rejected',rejection_reason=$1 WHERE reservation_id=$2`,[reason,req.params.id]);await addReservationHistory(req.params.id,old,'rejected',userId(req),reason);await audit(userId(req),'REJECT_RESERVATION','reservation',req.params.id,{reason});await notify(r.rows[0].requester_id,'Reservation rejected',reason);return ok(res,null,'Reservation rejected');}catch(e){return fail(res,500,'REJECTION_ERROR','Unable to reject reservation.');}});
router.get('/trips',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{try{const r=await pool.query(`SELECT t.*,r.vehicle_id,r.status AS reservation_status FROM trips t JOIN reservations r ON r.reservation_id=t.reservation_id ORDER BY t.created_at DESC`);return ok(res,r.rows);}catch(e){return fail(res,500,'TRIPS_ERROR','Unable to list trips.');}});
module.exports=router;
