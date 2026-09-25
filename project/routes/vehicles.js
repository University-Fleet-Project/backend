const express=require('express'); const {pool}=require('../config/db');
const {ok,fail,pagination,paged,audit,userId,checkVehicleAvailability}=require('../utils'); const {requireAuth,allowRoles}=require('../middleware/auth');
const router=express.Router();
router.get('/',requireAuth,async(req,res)=>{
 const {type,model,minSeats,maxSeats,transmission,fuelType,accessibility,status,availableFrom,availableTo,search,brandId}=req.query; const {page,limit,offset}=pagination(req);
 const vals=[],w=[];
 const add=(sql,v)=>{vals.push(v);w.push(sql.replace('?',`$${vals.length}`));};
 if(type)add(`vehicle_type ILIKE ?`,type); if(model)add(`model ILIKE ?`,model); if(minSeats)add(`seats>=?`,Number(minSeats)); if(maxSeats)add(`seats<=?`,Number(maxSeats)); if(transmission)add(`transmission ILIKE ?`,transmission); if(fuelType)add(`fuel_type ILIKE ?`,fuelType);
 if(status){
   if(String(status).toLowerCase()==='available'){
     w.push(`service_status IN ('available','active')`);
   }else{
     add(`service_status ILIKE ?`,status);
   }
 }
 if(search){vals.push(`%${search}%`);w.push(`(vehicle_id ILIKE $${vals.length} OR make ILIKE $${vals.length} OR model ILIKE $${vals.length} OR plate_number ILIKE $${vals.length})`);}
 if(accessibility==='true')w.push(`COALESCE(accessibility_features,'')<>''`);
 try{const where=w.length?`WHERE ${w.join(' AND ')}`:'';const c=await pool.query(`SELECT COUNT(*)::int total FROM vehicles ${where}`,vals);
  const r=await pool.query(
    `SELECT v.*,
            (SELECT COALESCE(image_url, url)
             FROM vehicle_photos
             WHERE vehicle_id = v.vehicle_id
             ORDER BY photo_id ASC
             LIMIT 1) AS primary_photo_url
     FROM vehicles v
     ${where}
     ORDER BY v.vehicle_id
     LIMIT ${limit} OFFSET ${offset}`,
    vals
  );
  const items = r.rows.map(row => {
    const pUrl = row.primary_photo_url || null;
    const { primary_photo_url, ...rest } = row;
    return {
      ...rest,
      imageUrl: pUrl,
      image_url: pUrl
    };
  });
  return paged(res,items,c.rows[0].total,page,limit);
 }catch(e){console.error(e);return fail(res,500,'VEHICLES_ERROR','Unable to list vehicles.');}
});
function formatPhoto(p){const u=p.image_url||p.url;return{photoId:p.photo_id,photo_id:p.photo_id,vehicleId:p.vehicle_id,vehicle_id:p.vehicle_id,imageUrl:u,image_url:u,url:u,caption:p.caption||null,createdAt:p.created_at||null,created_at:p.created_at||null};}
router.get('/:id',requireAuth,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT * FROM vehicles WHERE vehicle_id=$1`,[req.params.id]);
    if(!r.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');
    const v=r.rows[0];
    const s=await pool.query(`SELECT * FROM vehicle_specifications WHERE vehicle_id=$1`,[req.params.id]);
    const specRow=s.rows[0];

    const specObj=specRow||{
      vehicle_id:v.vehicle_id,
      nominal_l_per_100km:v.nominal_l_per_100km,
      tank_capacity_l:v.fuel_tank_capacity_l,
      accessibility:v.accessibility_features,
      transmission:v.transmission,
      allowed_load_kg:v.allowed_load_kg,
      updated_at:v.updated_at||null
    };

    const finalTransmission=v.transmission??specObj.transmission??null;
    const finalAccessibility=v.accessibility_features??specObj.accessibility??null;
    const finalTankCapacity=v.fuel_tank_capacity_l??specObj.tank_capacity_l??null;
    const finalNominalFuel=v.nominal_l_per_100km??specObj.nominal_l_per_100km??null;
    const finalAllowedLoad=v.allowed_load_kg??specObj.allowed_load_kg??null;

    const p=await pool.query(`SELECT * FROM vehicle_photos WHERE vehicle_id=$1 ORDER BY photo_id ASC`,[req.params.id]);
    const formattedPhotos=p.rows.map(formatPhoto);
    const primaryUrl=formattedPhotos[0]?.imageUrl||null;

    const vehicleData={
      ...v,
      transmission:finalTransmission,
      accessibility_features:finalAccessibility,
      fuel_tank_capacity_l:finalTankCapacity,
      nominal_l_per_100km:finalNominalFuel,
      allowed_load_kg:finalAllowedLoad,
      imageUrl:primaryUrl,
      image_url:primaryUrl,
      specification:{
        ...specObj,
        transmission:finalTransmission,
        accessibility:finalAccessibility,
        tank_capacity_l:finalTankCapacity,
        nominal_l_per_100km:finalNominalFuel,
        allowed_load_kg:finalAllowedLoad
      },
      photos:formattedPhotos
    };

    return ok(res,vehicleData);
  }catch(e){return fail(res,500,'VEHICLE_ERROR','Unable to get vehicle.');}
});
router.get('/:vehicleId/photos',requireAuth,async(req,res)=>{try{const v=await pool.query(`SELECT 1 FROM vehicles WHERE vehicle_id=$1`,[req.params.vehicleId]);if(!v.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');const r=await pool.query(`SELECT * FROM vehicle_photos WHERE vehicle_id=$1 ORDER BY photo_id`,[req.params.vehicleId]);return ok(res,r.rows.map(formatPhoto));}catch(e){return fail(res,500,'VEHICLE_PHOTO_ERROR','Unable to list vehicle photos.');}});
router.post('/:vehicleId/photos',requireAuth,allowRoles('fleet_admin','dispatcher'),async(req,res)=>{const b=req.body;const imgUrl=b.imageUrl||b.image_url||b.url;if(!imgUrl)return fail(res,400,'VALIDATION_ERROR','imageUrl is required.');try{const v=await pool.query(`SELECT 1 FROM vehicles WHERE vehicle_id=$1`,[req.params.vehicleId]);if(!v.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');const r=await pool.query(`INSERT INTO vehicle_photos(vehicle_id,url,image_url,caption,created_at) VALUES($1,$2,$2,$3,NOW()) RETURNING *`,[req.params.vehicleId,imgUrl,b.caption||null]);await audit(userId(req),'ADD_VEHICLE_PHOTO','vehicle',req.params.vehicleId,{photoId:r.rows[0].photo_id});return ok(res,formatPhoto(r.rows[0]),'Vehicle photo added',201);}catch(e){return fail(res,400,'VEHICLE_PHOTO_ERROR','Unable to add vehicle photo.');}});
router.delete('/:vehicleId/photos/:photoId',requireAuth,allowRoles('fleet_admin','dispatcher'),async(req,res)=>{try{const r=await pool.query(`DELETE FROM vehicle_photos WHERE photo_id=$1 AND vehicle_id=$2 RETURNING *`,[req.params.photoId,req.params.vehicleId]);if(!r.rows[0])return fail(res,404,'PHOTO_NOT_FOUND','Photo not found for this vehicle.');await audit(userId(req),'DELETE_VEHICLE_PHOTO','vehicle',req.params.vehicleId,{photoId:req.params.photoId});return ok(res,formatPhoto(r.rows[0]),'Vehicle photo deleted');}catch(e){return fail(res,400,'VEHICLE_PHOTO_ERROR','Unable to delete vehicle photo.');}});
router.post('/',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{
  const b=req.body;
  if(!b.vehicleId)return fail(res,400,'VALIDATION_ERROR','vehicleId is required.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(
      `INSERT INTO vehicles(vehicle_id,vehicle_type,make,model,vehicle_year,seats,fuel_type,nominal_l_per_100km,allowed_load_kg,service_status,plate_number,transmission,fuel_tank_capacity_l,accessibility_features,current_odometer)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [b.vehicleId,b.vehicleType,b.make,b.model,b.vehicleYear,b.seats,b.fuelType,b.nominalLPer100Km,b.allowedLoad,b.status||'available',b.plateNumber,b.transmission,b.tankCapacity,b.accessibilityFeatures,b.currentOdometer]
    );

    await client.query(
      `INSERT INTO vehicle_specifications(vehicle_id,nominal_l_per_100km,tank_capacity_l,accessibility,transmission,allowed_load_kg)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(vehicle_id) DO UPDATE SET
         nominal_l_per_100km=EXCLUDED.nominal_l_per_100km,
         tank_capacity_l=EXCLUDED.tank_capacity_l,
         accessibility=EXCLUDED.accessibility,
         transmission=EXCLUDED.transmission,
         allowed_load_kg=EXCLUDED.allowed_load_kg,
         updated_at=NOW()`,
      [b.vehicleId,b.nominalLPer100Km||null,b.tankCapacity||null,b.accessibilityFeatures||null,b.transmission||null,b.allowedLoad||null]
    );

    await client.query('COMMIT');
    await audit(req.user.sub,'CREATE_VEHICLE','vehicle',b.vehicleId);
    return ok(res,r.rows[0],'Vehicle created',201);
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_){}
    return fail(res,400,'CREATE_VEHICLE_ERROR',e.message);
  }finally{
    client.release();
  }
});
router.put('/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{
  const b=req.body;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(
      `UPDATE vehicles SET
         vehicle_type=COALESCE($1,vehicle_type),
         make=COALESCE($2,make),
         model=COALESCE($3,model),
         vehicle_year=COALESCE($4,vehicle_year),
         seats=COALESCE($5,seats),
         fuel_type=COALESCE($6,fuel_type),
         nominal_l_per_100km=COALESCE($7,nominal_l_per_100km),
         allowed_load_kg=COALESCE($8,allowed_load_kg),
         plate_number=COALESCE($9,plate_number),
         transmission=COALESCE($10,transmission),
         fuel_tank_capacity_l=COALESCE($11,fuel_tank_capacity_l),
         accessibility_features=COALESCE($12,accessibility_features)
       WHERE vehicle_id=$13 RETURNING *`,
      [b.vehicleType,b.make,b.model,b.vehicleYear,b.seats,b.fuelType,b.nominalLPer100Km,b.allowedLoad,b.plateNumber,b.transmission,b.tankCapacity,b.accessibilityFeatures,req.params.id]
    );

    if(!r.rows[0]){
      await client.query('ROLLBACK');
      return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');
    }

    const v=r.rows[0];
    await client.query(
      `INSERT INTO vehicle_specifications(vehicle_id,nominal_l_per_100km,tank_capacity_l,accessibility,transmission,allowed_load_kg)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(vehicle_id) DO UPDATE SET
         nominal_l_per_100km=COALESCE(EXCLUDED.nominal_l_per_100km, vehicle_specifications.nominal_l_per_100km),
         tank_capacity_l=COALESCE(EXCLUDED.tank_capacity_l, vehicle_specifications.tank_capacity_l),
         accessibility=COALESCE(EXCLUDED.accessibility, vehicle_specifications.accessibility),
         transmission=COALESCE(EXCLUDED.transmission, vehicle_specifications.transmission),
         allowed_load_kg=COALESCE(EXCLUDED.allowed_load_kg, vehicle_specifications.allowed_load_kg),
         updated_at=NOW()`,
      [v.vehicle_id,b.nominalLPer100Km||null,b.tankCapacity||null,b.accessibilityFeatures||null,b.transmission||null,b.allowedLoad||null]
    );

    await client.query('COMMIT');
    await audit(req.user.sub,'UPDATE_VEHICLE','vehicle',req.params.id);
    return ok(res,v,'Vehicle updated');
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_){}
    return fail(res,400,'UPDATE_VEHICLE_ERROR','Unable to update vehicle.');
  }finally{
    client.release();
  }
});
router.patch('/:id/status',requireAuth,allowRoles('fleet_admin','dispatcher'),async(req,res)=>{const {status}=req.body;if(!['available','unavailable','maintenance','inactive'].includes(status))return fail(res,400,'INVALID_STATUS','Invalid vehicle status.');try{const r=await pool.query(`UPDATE vehicles SET service_status=$1 WHERE vehicle_id=$2 RETURNING *`,[status,req.params.id]);if(!r.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');await audit(req.user.sub,'CHANGE_VEHICLE_STATUS','vehicle',req.params.id,{status});return ok(res,r.rows[0],'Vehicle status updated');}catch(e){return fail(res,400,'STATUS_ERROR','Unable to update vehicle status.');}});
router.delete('/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{try{const r=await pool.query(`UPDATE vehicles SET service_status='inactive' WHERE vehicle_id=$1 RETURNING vehicle_id,service_status`,[req.params.id]);if(!r.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');await audit(req.user.sub,'ARCHIVE_VEHICLE','vehicle',req.params.id);return ok(res,r.rows[0],'Vehicle archived');}catch(e){return fail(res,400,'ARCHIVE_ERROR','Unable to archive vehicle.');}});
router.get('/:id/availability',requireAuth,async(req,res)=>{try{const v=await pool.query(`SELECT service_status FROM vehicles WHERE vehicle_id=$1`,[req.params.id]);if(!v.rows[0])return fail(res,404,'VEHICLE_NOT_FOUND','Vehicle not found.');const serviceStatus=v.rows[0].service_status;const isOperable=['available','active'].includes(String(serviceStatus||'').trim().toLowerCase());const fromTs=req.query.from?new Date(req.query.from).toISOString():null;const toTs=req.query.to?new Date(req.query.to).toISOString():null;const r=await pool.query(`SELECT trip_start_timestamp AS start,trip_end_timestamp AS "end",status FROM reservations WHERE vehicle_id=$1 AND trip_start_timestamp IS NOT NULL AND trip_end_timestamp IS NOT NULL AND ($2::timestamp IS NULL OR trip_end_timestamp>$2::timestamp) AND ($3::timestamp IS NULL OR trip_start_timestamp<$3::timestamp) AND status IN('pending','approved','dispatched','active') ORDER BY trip_start_timestamp`,[req.params.id,fromTs,toTs]);const m=await pool.query(`SELECT start_at AS start,end_at AS "end",'maintenance' AS status FROM maintenance_records WHERE vehicle_id=$1 AND status<>'completed' AND ($2::timestamp IS NULL OR end_at>$2::timestamp) AND ($3::timestamp IS NULL OR start_at<$3::timestamp) ORDER BY start_at`,[req.params.id,fromTs,toTs]);return ok(res,{vehicleId:req.params.id,serviceStatus,isOperable,availability:[...r.rows,...m.rows]});}catch(e){return fail(res,500,'AVAILABILITY_ERROR','Unable to get availability.');}});
router.post('/check-availability',requireAuth,async(req,res)=>{const {vehicleId,startTime,endTime}=req.body;if(!vehicleId||!startTime||!endTime)return fail(res,400,'VALIDATION_ERROR','vehicleId, startTime and endTime are required.');try{const result=await checkVehicleAvailability(pool,vehicleId,startTime,endTime);if(result.code==='INVALID_TIMEFRAME')return fail(res,400,'INVALID_TIMEFRAME',result.message);if(result.code==='VEHICLE_NOT_FOUND')return fail(res,404,'VEHICLE_NOT_FOUND',result.message);return ok(res,{available:result.available,isOperable:result.isOperable??false,serviceStatus:result.serviceStatus??null,conflicts:result.conflicts??[]});}catch(e){return fail(res,500,'AVAILABILITY_ERROR','Unable to check availability.');}});
router.get('/:id/odometer',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM odometer_readings WHERE vehicle_id=$1 ORDER BY recorded_at DESC`,[req.params.id]);return ok(res,r.rows);}catch(e){return fail(res,500,'ODOMETER_ERROR','Unable to get odometer history.');}});
router.post('/:id/odometer',requireAuth,async(req,res)=>{const {value,recordedAt}=req.body;if(value==null)return fail(res,400,'VALIDATION_ERROR','value is required.');try{const r=await pool.query(`INSERT INTO odometer_readings(vehicle_id,value,recorded_at,recorded_by) VALUES($1,$2,COALESCE($3,NOW()),$4) RETURNING *`,[req.params.id,value,recordedAt||null,userId(req)]);await pool.query(`UPDATE vehicles SET current_odometer=$1 WHERE vehicle_id=$2`,[value,req.params.id]);await audit(userId(req),'RECORD_ODOMETER','vehicle',req.params.id,{value});return ok(res,r.rows[0],'Odometer recorded',201);}catch(e){return fail(res,400,'ODOMETER_ERROR','Unable to record odometer.');}});
module.exports=router;
