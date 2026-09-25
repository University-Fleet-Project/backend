const express=require('express');const bcrypt=require('bcryptjs');const {pool}=require('../config/db');const {ok,fail,pagination,paged,audit,userId}=require('../utils');const {requireAuth,allowRoles,normalizeRole}=require('../middleware/auth');const router=express.Router();
router.get('/',requireAuth,async(req,res)=>{const {search,status,qualification,available}=req.query;const {page,limit,offset}=pagination(req);const vals=[];const w=[];if(status){vals.push(status);w.push(`d.status=$${vals.length}`);}if(search){vals.push(`%${search}%`);w.push(`(d.license_number ILIKE $${vals.length} OR d.user_id ILIKE $${vals.length})`);}if(available==='true')w.push(`d.status='available'`);if(qualification){vals.push(qualification);w.push(`EXISTS(SELECT 1 FROM driver_qualifications q WHERE q.driver_id=d.driver_id AND q.qualification ILIKE $${vals.length} AND q.status='valid')`);}try{const where=w.length?`WHERE ${w.join(' AND ')}`:'';const c=await pool.query(`SELECT COUNT(*)::int total FROM drivers d ${where}`,vals);const r=await pool.query(`SELECT d.* FROM drivers d ${where} ORDER BY d.driver_id LIMIT ${limit} OFFSET ${offset}`,vals);return paged(res,r.rows,c.rows[0].total,page,limit);}catch(e){return fail(res,500,'DRIVERS_ERROR','Unable to list drivers.');}});
router.post('/apply', async (req, res) => {
  const { name, email, password, licenseNumber, license_number } = req.body;
  const lic = licenseNumber || license_number || null;

  if (!name || !email || !password) {
    return fail(res, 400, 'VALIDATION_ERROR', 'name, email and password are required.');
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    const existingCred = await pool.query(
      `SELECT 1 FROM fleet_api_credentials WHERE lower(email) = $1`,
      [cleanEmail]
    );
    if (existingCred.rows[0]) {
      return fail(res, 409, 'APPLICATION_EXISTS', 'An account with this email already exists.');
    }

    const existingApp = await pool.query(
      `SELECT 1 FROM driver_applications WHERE lower(email) = $1 AND status IN ('pending', 'approved')`,
      [cleanEmail]
    );
    if (existingApp.rows[0]) {
      return fail(res, 409, 'APPLICATION_EXISTS', 'A pending or approved application already exists for this email.');
    }

    const passHash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO driver_applications(name, email, password_hash, license_number, status)
       VALUES($1, $2, $3, $4, 'pending')
       RETURNING application_id, name, email, license_number, status, created_at`,
      [name.trim(), cleanEmail, passHash, lic]
    );

    const appRow = r.rows[0];
    const data = {
      applicationId: appRow.application_id,
      id: String(appRow.application_id),
      name: appRow.name,
      email: appRow.email,
      licenseNumber: appRow.license_number,
      status: appRow.status,
      createdAt: appRow.created_at
    };

    return ok(res, data, 'Driver application submitted successfully.', 201);
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'APPLICATION_ERROR', 'Unable to submit application.');
  }
});

router.get('/applications', requireAuth, allowRoles('fleet_admin', 'dispatcher'), async (req, res) => {
  const { status = 'pending' } = req.query;
  const { page, limit, offset } = pagination(req);

  const vals = [];
  const w = [];

  if (status && status !== 'all') {
    vals.push(String(status).toLowerCase());
    w.push(`status = $${vals.length}`);
  }

  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';

  try {
    const c = await pool.query(`SELECT COUNT(*)::int total FROM driver_applications ${where}`, vals);
    const r = await pool.query(
      `SELECT application_id, name, email, license_number, status, rejection_reason, reviewed_by, reviewed_at, created_at
       FROM driver_applications
       ${where}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      vals
    );

    const items = r.rows.map(row => ({
      applicationId: row.application_id,
      id: String(row.application_id),
      name: row.name,
      email: row.email,
      licenseNumber: row.license_number,
      status: row.status,
      rejectionReason: row.rejection_reason || null,
      reviewedBy: row.reviewed_by || null,
      reviewedAt: row.reviewed_at || null,
      createdAt: row.created_at
    }));

    return paged(res, items, c.rows[0].total, page, limit);
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'APPLICATIONS_ERROR', 'Unable to list driver applications.');
  }
});

router.post('/applications/:id/approve', requireAuth, allowRoles('fleet_admin', 'dispatcher'), async (req, res) => {
  const idStr = String(req.params.id || '').trim();
  if (!/^[1-9]\d*$/.test(idStr)) {
    return fail(res, 400, 'INVALID_APPLICATION_ID', 'Application ID must be a positive integer.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appRes = await client.query(
      `SELECT * FROM driver_applications WHERE application_id = $1 FOR UPDATE`,
      [idStr]
    );

    if (!appRes.rows[0]) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    const appRow = appRes.rows[0];
    if (appRow.status !== 'pending') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'INVALID_STATUS', 'Only pending applications can be approved.');
    }

    const credCheck = await client.query(
      `SELECT 1 FROM fleet_api_credentials WHERE lower(email) = lower($1)`,
      [appRow.email]
    );
    if (credCheck.rows[0]) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const uRes = await client.query(
      `INSERT INTO users(name, role) VALUES($1, 'driver') RETURNING *`,
      [appRow.name]
    );
    const user = uRes.rows[0];

    await client.query(
      `INSERT INTO fleet_api_credentials(user_id, email, password_hash) VALUES($1, $2, $3)`,
      [String(user.user_id), appRow.email, appRow.password_hash]
    );

    const drRes = await client.query(
      `INSERT INTO drivers(user_id, status, license_number) VALUES($1, 'available', $2) RETURNING *`,
      [String(user.user_id), appRow.license_number || null]
    );
    const driver = drRes.rows[0];

    await client.query(
      `UPDATE driver_applications SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW() WHERE application_id = $2`,
      [String(userId(req)), idStr]
    );

    await client.query('COMMIT');

    await audit(userId(req), 'APPROVE_DRIVER_APPLICATION', 'driver_application', idStr, {
      userId: String(user.user_id),
      driverId: driver.driver_id
    });
    await audit(userId(req), 'CREATE_USER', 'user', user.user_id);
    await audit(userId(req), 'CREATE_DRIVER', 'driver', driver.driver_id);

    return ok(res, {
      applicationId: Number(idStr),
      status: 'approved',
      userId: String(user.user_id),
      driverId: driver.driver_id,
      driver: driver
    }, 'Driver application approved.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e);
    return fail(res, 500, 'APPROVE_ERROR', 'Unable to approve application.');
  } finally {
    client.release();
  }
});

router.post('/applications/:id/reject', requireAuth, allowRoles('fleet_admin', 'dispatcher'), async (req, res) => {
  const idStr = String(req.params.id || '').trim();
  if (!/^[1-9]\d*$/.test(idStr)) {
    return fail(res, 400, 'INVALID_APPLICATION_ID', 'Application ID must be a positive integer.');
  }

  const reason = req.body?.rejectionReason ?? req.body?.reason ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appRes = await client.query(
      `SELECT * FROM driver_applications WHERE application_id = $1 FOR UPDATE`,
      [idStr]
    );

    if (!appRes.rows[0]) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    const appRow = appRes.rows[0];
    if (appRow.status !== 'pending') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'INVALID_STATUS', 'Only pending applications can be rejected.');
    }

    await client.query(
      `UPDATE driver_applications SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW() WHERE application_id = $3`,
      [reason, String(userId(req)), idStr]
    );

    await client.query('COMMIT');

    await audit(userId(req), 'REJECT_DRIVER_APPLICATION', 'driver_application', idStr, { reason });

    return ok(res, {
      applicationId: Number(idStr),
      status: 'rejected',
      rejectionReason: reason
    }, 'Driver application rejected.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e);
    return fail(res, 500, 'REJECT_ERROR', 'Unable to reject application.');
  } finally {
    client.release();
  }
});

router.get('/:id',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM drivers WHERE driver_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'DRIVER_NOT_FOUND','Driver not found.');const q=await pool.query(`SELECT * FROM driver_qualifications WHERE driver_id=$1 ORDER BY valid_to DESC NULLS LAST`,[req.params.id]);return ok(res,{...r.rows[0],qualifications:q.rows});}catch(e){return fail(res,500,'DRIVER_ERROR','Unable to get driver.');}});
router.post('/',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{
  const b=req.body;
  const targetUserId=b.userId??b.user_id;

  if(!targetUserId && (!b.name || !b.email)){
    return fail(res,400,'VALIDATION_ERROR','userId or (name and email) is required.');
  }

  const client=await pool.connect();
  try{
    await client.query('BEGIN');

    let uId=targetUserId;
    if(!uId){
      const existingCred=await client.query(`SELECT 1 FROM fleet_api_credentials WHERE lower(email)=lower($1)`,[b.email]);
      if(existingCred.rows[0]){
        await client.query('ROLLBACK');
        return fail(res,409,'EMAIL_EXISTS','Email already registered.');
      }
      const uRes=await client.query(`INSERT INTO users(name,role) VALUES($1,'driver') RETURNING *`,[b.name]);
      const user=uRes.rows[0];
      uId=user.user_id;
      const passHash=await bcrypt.hash(b.password||'password',12);
      await client.query(`INSERT INTO fleet_api_credentials(user_id,email,password_hash) VALUES($1,$2,$3)`,[String(uId),b.email,passHash]);
      await audit(userId(req),'CREATE_USER','user',uId);
    }else{
      const userCheck=await client.query(`SELECT * FROM users WHERE CAST(user_id AS TEXT)=$1`,[String(uId)]);
      if(!userCheck.rows[0]){
        await client.query('ROLLBACK');
        return fail(res,404,'USER_NOT_FOUND','User not found.');
      }
      if(normalizeRole(userCheck.rows[0].role)!=='driver'){
        await client.query(`UPDATE users SET role='driver' WHERE user_id=$1`,[userCheck.rows[0].user_id]);
      }
      const existingDriver=await client.query(`SELECT 1 FROM drivers WHERE CAST(user_id AS TEXT)=$1`,[String(uId)]);
      if(existingDriver.rows[0]){
        await client.query('ROLLBACK');
        return fail(res,409,'DUPLICATE_DRIVER','Driver record already exists for this user.');
      }
    }

    const lic=b.licenseNumber||b.license_number||null;
    const drStatus=b.status||'available';
    const r=await client.query(`INSERT INTO drivers(user_id,status,license_number) VALUES($1,$2,$3) RETURNING *`,[String(uId),drStatus,lic]);
    await client.query('COMMIT');
    await audit(userId(req),'CREATE_DRIVER','driver',r.rows[0].driver_id);
    return ok(res,r.rows[0],'Driver created',201);
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_){}
    console.error(e);
    if(e.code==='23505') return fail(res,409,'CREATE_DRIVER_ERROR','Driver or email already exists.');
    return fail(res,400,'CREATE_DRIVER_ERROR','Unable to create driver.');
  }finally{
    client.release();
  }
});
router.put('/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{try{const b=req.body;const r=await pool.query(`UPDATE drivers SET user_id=COALESCE($1,user_id),status=COALESCE($2,status),license_number=COALESCE($3,license_number) WHERE driver_id=$4 RETURNING *`,[b.userId,b.status,b.licenseNumber,req.params.id]);if(!r.rows[0])return fail(res,404,'DRIVER_NOT_FOUND','Driver not found.');await audit(userId(req),'UPDATE_DRIVER','driver',req.params.id);return ok(res,r.rows[0],'Driver updated');}catch(e){return fail(res,400,'UPDATE_DRIVER_ERROR','Unable to update driver.');}});
router.get('/:id/qualifications',requireAuth,async(req,res)=>{const r=await pool.query(`SELECT * FROM driver_qualifications WHERE driver_id=$1 ORDER BY valid_to DESC NULLS LAST`,[req.params.id]);return ok(res,r.rows);});
router.post('/:id/qualifications',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{const b=req.body;if(!b.qualification)return fail(res,400,'VALIDATION_ERROR','qualification is required.');try{const r=await pool.query(`INSERT INTO driver_qualifications(driver_id,qualification,valid_from,valid_to,status) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.params.id,b.qualification,b.validFrom||null,b.validTo||null,b.status||'valid']);return ok(res,r.rows[0],'Qualification added',201);}catch(e){return fail(res,400,'QUALIFICATION_ERROR','Unable to add qualification.');}});
router.put('/:id/qualifications/:qualificationId',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{const b=req.body;try{const r=await pool.query(`UPDATE driver_qualifications SET qualification=COALESCE($1,qualification),valid_from=COALESCE($2,valid_from),valid_to=COALESCE($3,valid_to),status=COALESCE($4,status) WHERE qualification_id=$5 AND driver_id=$6 RETURNING *`,[b.qualification,b.validFrom,b.validTo,b.status,req.params.qualificationId,req.params.id]);if(!r.rows[0])return fail(res,404,'QUALIFICATION_NOT_FOUND','Qualification not found.');return ok(res,r.rows[0],'Qualification updated');}catch(e){return fail(res,400,'QUALIFICATION_ERROR','Unable to update qualification.');}});
router.get('/:id/availability',requireAuth,async(req,res)=>{
  const idStr=String(req.params.id||'').trim();
  if(!/^[1-9]\d*$/.test(idStr)){
    return fail(res,400,'INVALID_DRIVER_ID','Driver ID must be a positive integer.');
  }
  try{
    const dr=await pool.query(`SELECT 1 FROM drivers WHERE driver_id=$1`,[idStr]);
    if(!dr.rows[0])return fail(res,404,'DRIVER_NOT_FOUND','Driver not found.');
    const r=await pool.query(`SELECT reservation_id,trip_start_timestamp AS start,trip_end_timestamp AS "end",status FROM reservations WHERE driver_id=$1 AND status IN('approved','active','dispatched') ORDER BY trip_start_timestamp`,[idStr]);
    return ok(res,{driverId:idStr,availability:r.rows});
  }catch(e){return fail(res,500,'DRIVER_AVAILABILITY_ERROR','Unable to get driver availability.');}
});
module.exports=router;
