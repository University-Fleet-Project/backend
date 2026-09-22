const express=require('express'); const {pool}=require('../config/db'); const {ok,fail,pagination,paged,audit,notify,addReservationHistory,addTripHistory,userId}=require('../utils'); const {requireAuth,allowRoles}=require('../middleware/auth');
const router=express.Router();

router.get('/reservations',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{const {status='pending',date,vehicleType,search}=req.query;const {page,limit,offset}=pagination(req);const vals=[];const w=[];const add=(s,v)=>{vals.push(v);w.push(s.replace('?',`$${vals.length}`));};if(status)add(`r.status=?`,status);if(vehicleType)add(`r.vehicle_type ILIKE ?`,vehicleType);if(date)add(`DATE(r.trip_start_timestamp)=?`,date);if(search){vals.push(`%${search}%`);w.push(`(r.reservation_id ILIKE $${vals.length} OR r.origin ILIKE $${vals.length} OR r.destination ILIKE $${vals.length})`);}try{const where=w.length?`WHERE ${w.join(' AND ')}`:'';const c=await pool.query(`SELECT COUNT(*)::int total FROM reservations r ${where}`,vals);const r=await pool.query(`SELECT r.* FROM reservations r ${where} ORDER BY r.request_timestamp DESC LIMIT ${limit} OFFSET ${offset}`,vals);return paged(res,r.rows,c.rows[0].total,page,limit);}catch(e){return fail(res,500,'DISPATCHER_ERROR','Unable to list dispatcher reservations.');}});
router.get('/reservations/:id',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');return ok(res,r.rows[0]);});

router.post('/reservations/:id/approve',requireAuth,allowRoles('dispatcher','fleet_admin'),async(req,res)=>{
 const {vehicleId,driverId,reason}=req.body; if(!vehicleId||!driverId)return fail(res,400,'VALIDATION_ERROR','vehicleId and driverId are required.');
 const client=await pool.connect();
 try{
   await client.query('BEGIN');
   const rr=await client.query(`SELECT * FROM reservations WHERE reservation_id=$1 FOR UPDATE`,[req.params.id]); if(!rr.rows[0]){await client.query('ROLLBACK');return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');}
   const reservation=rr.rows[0]; if(!['pending','rejected'].includes(reservation.status)){await client.query('ROLLBACK');return fail(res,409,'INVALID_STATUS','Only pending reservations can be approved.');}
   await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[String(vehicleId)]);
   const v=await client.query(`SELECT * FROM vehicles WHERE vehicle_id=$1 FOR UPDATE`,[vehicleId]);if(!v.rows[0]){await client.query('ROLLBACK');return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');}
   if(v.rows[0].service_status!=='available'){await client.query('ROLLBACK');return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is not available.');}
   if(Number(reservation.passengers||0)>Number(v.rows[0].seats||Infinity)){await client.query('ROLLBACK');return fail(res,400,'PASSENGER_CAPACITY_EXCEEDED','Passenger count exceeds vehicle capacity.');}
   if(reservation.load_kg!=null&&v.rows[0].allowed_load_kg!=null&&Number(reservation.load_kg)>Number(v.rows[0].allowed_load_kg)){await client.query('ROLLBACK');return fail(res,400,'LOAD_CAPACITY_EXCEEDED','Load exceeds vehicle capacity.');}
   const overlap=await client.query(`SELECT reservation_id FROM reservations WHERE vehicle_id=$1 AND status IN('approved','active') AND trip_start_timestamp<$3 AND trip_end_timestamp>$2 LIMIT 1`,[vehicleId,reservation.trip_start_timestamp,reservation.trip_end_timestamp]);
   if(overlap.rows[0]){await client.query('ROLLBACK');return fail(res,409,'VEHICLE_CONFLICT','Vehicle already allocated for an overlapping trip.',{conflictReservationId:overlap.rows[0].reservation_id});}
   const old=reservation.status;
   await client.query(`UPDATE reservations SET vehicle_id=$1,driver_id=$2,status='approved',approval_timestamp=NOW() WHERE reservation_id=$3`,[vehicleId,driverId,req.params.id]);
   await client.query('COMMIT');
   await addReservationHistory(req.params.id,old,'approved',userId(req),reason||'Approved after availability check');
   await audit(userId(req),'APPROVE_RESERVATION','reservation',req.params.id,{vehicleId,driverId});
   await notify(reservation.requester_id,'Reservation approved','Your reservation has been approved.');
   return ok(res,{reservationId:req.params.id,vehicleId,driverId,status:'approved'},'Reservation approved');
 }catch(e){try{await client.query('ROLLBACK')}catch{};console.error(e);return fail(res,500,'APPROVAL_ERROR','Server error during approval.');}finally{client.release();}
});
router.post('/reservations/:id/reject',requireAuth,allowRoles('dispatcher','fleet_admin'),async(req,res)=>{const reason=req.body.reason||'Rejected';try{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');const old=r.rows[0].status;await pool.query(`UPDATE reservations SET status='rejected',rejection_reason=$1 WHERE reservation_id=$2`,[reason,req.params.id]);await addReservationHistory(req.params.id,old,'rejected',userId(req),reason);await audit(userId(req),'REJECT_RESERVATION','reservation',req.params.id,{reason});await notify(r.rows[0].requester_id,'Reservation rejected',reason);return ok(res,null,'Reservation rejected');}catch(e){return fail(res,500,'REJECTION_ERROR','Unable to reject reservation.');}});
router.get('/trips',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{try{const r=await pool.query(`SELECT t.*,r.vehicle_id,r.status AS reservation_status FROM trips t JOIN reservations r ON r.reservation_id=t.reservation_id ORDER BY t.created_at DESC`);return ok(res,r.rows);}catch(e){return fail(res,500,'TRIPS_ERROR','Unable to list trips.');}});
module.exports=router;
