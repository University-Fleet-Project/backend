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
module.exports={ok,fail,pagination,paged,parseDate,audit,notify,addReservationHistory,addTripHistory,userId};
