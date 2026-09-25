const express=require('express');const {pool}=require('../config/db');const {ok,fail}=require('../utils');const {requireAuth,allowRoles}=require('../middleware/auth');const router=express.Router();
router.get('/brands',requireAuth,async(req,res)=>ok(res,(await pool.query(`SELECT * FROM fleet_brands ORDER BY name`)).rows));
router.post('/brands',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{try{return ok(res,(await pool.query(`INSERT INTO fleet_brands(name) VALUES($1) RETURNING *`,[req.body.name])).rows[0],'Brand created',201);}catch(e){return fail(res,400,'BRAND_ERROR','Unable to create brand.')}});
router.put('/brands/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{try{const r=await pool.query(`UPDATE fleet_brands SET name=$1 WHERE brand_id=$2 RETURNING *`,[req.body.name,req.params.id]);if(!r.rows[0])return fail(res,404,'BRAND_NOT_FOUND','Brand not found.');return ok(res,r.rows[0],'Brand updated');}catch(e){return fail(res,400,'BRAND_ERROR','Unable to update brand.')}});
router.delete('/brands/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{await pool.query(`DELETE FROM fleet_brands WHERE brand_id=$1`,[req.params.id]);return ok(res,null,'Brand deleted');});
router.get('/models',requireAuth,async(req,res)=>ok(res,(await pool.query(`SELECT * FROM fleet_models ORDER BY name`)).rows));
router.post('/models',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{try{return ok(res,(await pool.query(`INSERT INTO fleet_models(brand_id,name) VALUES($1,$2) RETURNING *`,[req.body.brandId||null,req.body.name])).rows[0],'Model created',201);}catch(e){return fail(res,400,'MODEL_ERROR','Unable to create model.')}});
router.put('/models/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{const r=await pool.query(`UPDATE fleet_models SET brand_id=COALESCE($1,brand_id),name=COALESCE($2,name) WHERE model_id=$3 RETURNING *`,[req.body.brandId,req.body.name,req.params.id]);if(!r.rows[0])return fail(res,404,'MODEL_NOT_FOUND','Model not found.');return ok(res,r.rows[0],'Model updated');});
router.delete('/models/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{await pool.query(`DELETE FROM fleet_models WHERE model_id=$1`,[req.params.id]);return ok(res,null,'Model deleted');});
router.get('/vehicle-specifications/:vehicleId',requireAuth,async(req,res)=>{const r=await pool.query(`SELECT v.vehicle_id,v.nominal_l_per_100km,v.fuel_tank_capacity_l AS "tankCapacity",v.accessibility_features AS accessibility,v.transmission,v.allowed_load_kg AS "allowedLoad",s.* FROM vehicles v LEFT JOIN vehicle_specifications s ON s.vehicle_id=v.vehicle_id WHERE v.vehicle_id=$1`,[req.params.vehicleId]);if(!r.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');return ok(res,r.rows[0]);});
router.put('/vehicle-specifications/:vehicleId',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{
  const b=req.body;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(
      `INSERT INTO vehicle_specifications(vehicle_id,nominal_l_per_100km,tank_capacity_l,accessibility,transmission,allowed_load_kg)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(vehicle_id) DO UPDATE SET
         nominal_l_per_100km=EXCLUDED.nominal_l_per_100km,
         tank_capacity_l=EXCLUDED.tank_capacity_l,
         accessibility=EXCLUDED.accessibility,
         transmission=EXCLUDED.transmission,
         allowed_load_kg=EXCLUDED.allowed_load_kg,
         updated_at=NOW() RETURNING *`,
      [req.params.vehicleId,b.nominalLPer100Km,b.tankCapacity,b.accessibility,b.transmission,b.allowedLoad]
    );

    const vUpdate=await client.query(
      `UPDATE vehicles SET
         nominal_l_per_100km=COALESCE($2,nominal_l_per_100km),
         fuel_tank_capacity_l=COALESCE($3,fuel_tank_capacity_l),
         accessibility_features=COALESCE($4,accessibility_features),
         transmission=COALESCE($5,transmission),
         allowed_load_kg=COALESCE($6,allowed_load_kg)
       WHERE vehicle_id=$1 RETURNING *`,
      [req.params.vehicleId,b.nominalLPer100Km,b.tankCapacity,b.accessibility,b.transmission,b.allowedLoad]
    );

    if(!vUpdate.rows[0]){
      await client.query('ROLLBACK');
      return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');
    }

    await client.query('COMMIT');
    return ok(res,r.rows[0],'Specification updated');
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_){}
    return fail(res,400,'SPEC_ERROR','Unable to update specification.');
  }finally{
    client.release();
  }
});
module.exports=router;
