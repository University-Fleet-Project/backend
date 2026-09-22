const express=require('express'); const {pool}=require('../config/db'); const {ok,fail,pagination,paged,audit,notify,addReservationHistory,userId}=require('../utils'); const {requireAuth,allowRoles}=require('../middleware/auth');
const router=express.Router();

function bodyValue(b,a,c){return b[a]!==undefined?b[a]:b[c];}
 router.post('/',requireAuth,async(req,res)=>{
 const b=req.body; const requesterId=userId(req)||bodyValue(b,'requesterId','requester_id'); const vehicleId=bodyValue(b,'vehicleId','vehicle_id');
 const start=bodyValue(b,'startTime','start_time'), end=bodyValue(b,'endTime','end_time');
 const origin=typeof b.origin==='object'?JSON.stringify(b.origin):b.origin, destination=typeof b.destination==='object'?JSON.stringify(b.destination):b.destination;
 if(!requesterId||!vehicleId||!start||!end||!origin||!destination||b.passengers==null||b.distanceKm==null&&b.distance_km==null)return fail(res,400,'VALIDATION_ERROR','vehicleId, startTime, endTime, origin, destination, passengers and distanceKm are required.');
 const sDate=new Date(start), eDate=new Date(end);
 if(Number.isNaN(sDate.getTime())||Number.isNaN(eDate.getTime())||eDate<=sDate)return fail(res,400,'INVALID_TIMEFRAME','startTime and endTime must be valid ISO dates with startTime before endTime.');
 const distance=bodyValue(b,'distanceKm','distance_km');
 const comment=b.comment??b.notes??null;
 try{
   const v=await pool.query(`SELECT * FROM vehicles WHERE vehicle_id=$1`,[vehicleId]); if(!v.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');
    const currentStatus = String(v.rows[0].service_status || '').trim().toLowerCase();
    if(!['available','active'].includes(currentStatus))return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is not currently available.');
    if(Number(b.passengers)>Number(v.rows[0].seats))return fail(res,400,'PASSENGER_CAPACITY_EXCEEDED','Passenger count exceeds vehicle capacity.');
    if(b.load!=null && v.rows[0].allowed_load_kg!=null && Number(b.load)>Number(v.rows[0].allowed_load_kg))return fail(res,400,'LOAD_CAPACITY_EXCEEDED','Load exceeds vehicle capacity.');
    const maintConflict=await pool.query(`SELECT maintenance_id FROM maintenance_records WHERE vehicle_id=$1 AND status<>'completed' AND start_at<$3 AND end_at>$2 LIMIT 1`,[vehicleId,start,end]);
    if(maintConflict.rows[0])return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is under maintenance for the selected time.');
    const conflict=await pool.query(`SELECT reservation_id FROM reservations WHERE vehicle_id=$1 AND status IN('approved','active') AND trip_start_timestamp<$3 AND trip_end_timestamp>$2 LIMIT 1`,[vehicleId,start,end]);
   if(conflict.rows[0])return fail(res,409,'VEHICLE_NOT_AVAILABLE','Vehicle is already allocated for the selected time.');
   const nominal=Number(v.rows[0].nominal_l_per_100km||0), est=Number(distance)*nominal/100;
   const id='FLT-RES-'+Date.now();
   const r=await pool.query(`INSERT INTO reservations(reservation_id,vehicle_id,vehicle_type,request_timestamp,trip_start_timestamp,trip_end_timestamp,status,origin,destination,route_km,estimated_fuel_liters,passengers,load_kg,requester_id,comment) VALUES($1,$2,$3,NOW(),$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[id,vehicleId,v.rows[0].vehicle_type,start,end,origin,destination,distance,est,b.passengers,b.load??b.load_kg??0,requesterId,comment]);
   await addReservationHistory(id,null,'pending',requesterId,'Reservation created'); await audit(requesterId,'CREATE_RESERVATION','reservation',id); return ok(res,r.rows[0],'Reservation created',201);
 }catch(e){console.error(e);return fail(res,400,'CREATE_RESERVATION_ERROR',e.message);}
});
router.get('/my',requireAuth,async(req,res)=>{const {status,from,to}=req.query;const {page,limit,offset}=pagination(req);const vals=[userId(req)];const w=['requester_id=$1'];if(status){vals.push(status);w.push(`status=$${vals.length}`);}if(from){vals.push(from);w.push(`trip_start_timestamp>=$${vals.length}`);}if(to){vals.push(to);w.push(`trip_end_timestamp<=$${vals.length}`);}try{const c=await pool.query(`SELECT COUNT(*)::int total FROM reservations WHERE ${w.join(' AND ')}`,vals);const r=await pool.query(`SELECT * FROM reservations WHERE ${w.join(' AND ')} ORDER BY request_timestamp DESC LIMIT ${limit} OFFSET ${offset}`,vals);return paged(res,r.rows,c.rows[0].total,page,limit);}catch(e){return fail(res,500,'RESERVATIONS_ERROR','Unable to list reservations.');}});
router.get('/',requireAuth,allowRoles('dispatcher','fleet_admin','auditor'),async(req,res)=>{try{const r=await pool.query(`SELECT * FROM reservations ORDER BY request_timestamp DESC`);return ok(res,r.rows);}catch(e){return fail(res,500,'RESERVATIONS_ERROR','Unable to list reservations.');}});
router.get('/:id',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');return ok(res,r.rows[0]);}catch(e){return fail(res,500,'RESERVATION_ERROR','Unable to get reservation.');}});
router.post('/:id/cancel',requireAuth,async(req,res)=>{const reason=req.body.reason||'Cancelled by requester';try{const r=await pool.query(`SELECT * FROM reservations WHERE reservation_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'RESERVATION_NOT_FOUND','Reservation not found.');if(String(r.rows[0].requester_id)!==String(userId(req))&&!['dispatcher','fleet_admin'].includes(req.user.role))return fail(res,403,'FORBIDDEN','You cannot cancel this reservation.');const old=r.rows[0].status;await pool.query(`UPDATE reservations SET status='cancelled',rejection_reason=$1 WHERE reservation_id=$2`,[reason,req.params.id]);await addReservationHistory(req.params.id,old,'cancelled',userId(req),reason);await audit(userId(req),'CANCEL_RESERVATION','reservation',req.params.id,{reason});return ok(res,null,'Reservation cancelled');}catch(e){return fail(res,500,'CANCEL_ERROR','Unable to cancel reservation.');}});
router.get('/:id/status-history',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM reservation_status_history WHERE reservation_id=$1 ORDER BY changed_at`,[req.params.id]);return ok(res,r.rows);}catch(e){return fail(res,500,'HISTORY_ERROR','Unable to get reservation status history.');}});
module.exports=router;
