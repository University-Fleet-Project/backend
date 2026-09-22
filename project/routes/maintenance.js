const express=require('express');const {pool}=require('../config/db');const {ok,fail,audit,userId}=require('../utils');const {requireAuth,allowRoles}=require('../middleware/auth');const router=express.Router();

router.get('/:id/maintenance',requireAuth,async(req,res)=>{const r=await pool.query(`SELECT * FROM maintenance_records WHERE vehicle_id=$1 ORDER BY start_at DESC`,[req.params.id]);return ok(res,r.rows);});
router.post('/:id/maintenance',requireAuth,allowRoles('fleet_admin','dispatcher'),async(req,res)=>{const b=req.body;try{const r=await pool.query(`INSERT INTO maintenance_records(vehicle_id,maintenance_type,description,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.params.id,b.maintenanceType,b.description,b.startAt||null,b.endAt||null,b.status||'open']);if(b.status==='open')await pool.query(`UPDATE vehicles SET service_status='maintenance' WHERE vehicle_id=$1`,[req.params.id]);await audit(userId(req),'CREATE_MAINTENANCE','vehicle',req.params.id);return ok(res,r.rows[0],'Maintenance created',201);}catch(e){return fail(res,400,'MAINTENANCE_ERROR','Unable to create maintenance.');}});

async function updateMaintenance(req,res){
  const maintenanceId=req.params.maintenanceId||req.params.id;
  const b=req.body;
  try{
    const r=await pool.query(`UPDATE maintenance_records SET maintenance_type=COALESCE($1,maintenance_type),description=COALESCE($2,description),start_at=COALESCE($3,start_at),end_at=COALESCE($4,end_at),status=COALESCE($5,status) WHERE maintenance_id=$6 RETURNING *`,[b.maintenanceType,b.description,b.startAt,b.endAt,b.status,maintenanceId]);
    if(!r.rows[0])return fail(res,404,'MAINTENANCE_NOT_FOUND','Maintenance record not found.');
    return ok(res,r.rows[0],'Maintenance updated');
  }catch(e){return fail(res,400,'MAINTENANCE_ERROR','Unable to update maintenance.');}
}
router.put('/maintenance/:maintenanceId',requireAuth,allowRoles('fleet_admin','dispatcher'),updateMaintenance);
router.put('/:id',requireAuth,allowRoles('fleet_admin','dispatcher'),updateMaintenance);

async function completeMaintenance(req,res){
  const maintenanceId=req.params.maintenanceId||req.params.id;
  try{
    const r=await pool.query(`UPDATE maintenance_records SET status='completed',end_at=COALESCE(end_at,NOW()) WHERE maintenance_id=$1 RETURNING *`,[maintenanceId]);
    if(!r.rows[0])return fail(res,404,'MAINTENANCE_NOT_FOUND','Maintenance record not found.');
    const open=await pool.query(`SELECT 1 FROM maintenance_records WHERE vehicle_id=$1 AND status<>'completed' LIMIT 1`,[r.rows[0].vehicle_id]);
    if(!open.rows[0])await pool.query(`UPDATE vehicles SET service_status='available' WHERE vehicle_id=$1`,[r.rows[0].vehicle_id]);
    await audit(userId(req),'COMPLETE_MAINTENANCE','maintenance',maintenanceId);
    return ok(res,r.rows[0],'Maintenance completed');
  }catch(e){return fail(res,400,'MAINTENANCE_ERROR','Unable to complete maintenance.');}
}
router.post('/maintenance/:maintenanceId/complete',requireAuth,allowRoles('fleet_admin','dispatcher'),completeMaintenance);
router.post('/:id/complete',requireAuth,allowRoles('fleet_admin','dispatcher'),completeMaintenance);

router.get('/:id',requireAuth,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT * FROM maintenance_records WHERE maintenance_id=$1`,[req.params.id]);
    if(!r.rows[0])return fail(res,404,'MAINTENANCE_NOT_FOUND','Maintenance record not found.');
    return ok(res,r.rows[0]);
  }catch(e){return fail(res,500,'MAINTENANCE_ERROR','Unable to get maintenance record.');}
});

module.exports=router;
