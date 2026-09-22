const express=require('express'); const bcrypt=require('bcryptjs');
const {pool}=require('../config/db'); const {ok,fail,pagination,paged,audit}=require('../utils');
const {requireAuth,allowRoles,normalizeRole}=require('../middleware/auth');
const router=express.Router();

async function ensureCredential(user,email,password='password'){
  await pool.query(`INSERT INTO fleet_api_credentials(user_id,email,password_hash) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email`,[String(user.user_id),email,await bcrypt.hash(password,12)]);
}
router.get('/',requireAuth,allowRoles('fleet_admin','dispatcher','auditor'),async(req,res)=>{
  const {role,status,search}=req.query; const {page,limit,offset}=pagination(req);
  const vals=[]; const w=[];
  if(role){vals.push(role);w.push(`lower(role)=lower($${vals.length})`);}
  if(search){vals.push(`%${search}%`);w.push(`(name ILIKE $${vals.length})`);}
  const where=w.length?`WHERE ${w.join(' AND ')}`:'';
  try{
    const c=await pool.query(`SELECT COUNT(*)::int total FROM users ${where}`,vals);
    const r=await pool.query(`SELECT user_id,name,role FROM users ${where} ORDER BY user_id LIMIT ${limit} OFFSET ${offset}`,vals);
    const items=await Promise.all(r.rows.map(async u=>{const x=await pool.query(`SELECT email,status FROM fleet_api_credentials WHERE user_id=$1`,[String(u.user_id)]);return {...u,id:String(u.user_id),role:normalizeRole(u.role),email:x.rows[0]?.email||null,status:x.rows[0]?.status||'active'};}));
    return paged(res,items,c.rows[0].total,page,limit);
  }catch(e){console.error(e);return fail(res,500,'USERS_ERROR','Unable to list users.');}
});
router.get('/:id',requireAuth,async(req,res)=>{try{const r=await pool.query(`SELECT * FROM users WHERE user_id=$1`,[req.params.id]);if(!r.rows[0])return fail(res,404,'USER_NOT_FOUND','User not found.');const c=await pool.query(`SELECT email,status FROM fleet_api_credentials WHERE user_id=$1`,[req.params.id]);return ok(res,{...r.rows[0],id:String(r.rows[0].user_id),email:c.rows[0]?.email||null,status:c.rows[0]?.status||'active'});}catch(e){return fail(res,500,'USER_ERROR','Unable to get user.');}});
router.post('/',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{
  const {name,role,email,password='password'}=req.body; if(!name||!role||!email)return fail(res,400,'VALIDATION_ERROR','name, role and email are required.');
  try{const allowed=['requester','dispatcher','driver','fleet_admin','auditor'];if(!allowed.includes(normalizeRole(role)))return fail(res,400,'INVALID_ROLE','Invalid role.');
    const r=await pool.query(`INSERT INTO users(name,role) VALUES($1,$2) RETURNING *`,[name,role]);
    await ensureCredential(r.rows[0],email,password); await audit(req.user.sub,'CREATE_USER','user',r.rows[0].user_id);
    return ok(res,{...r.rows[0],email},'User created',201);
  }catch(e){console.error(e);return fail(res,400,'CREATE_USER_ERROR',e.code==='23505'?'User already exists.':'Unable to create user.');}
});
router.put('/:id',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{const {name,role,email}=req.body;try{const r=await pool.query(`UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role) WHERE user_id=$3 RETURNING *`,[name,role,req.params.id]);if(!r.rows[0])return fail(res,404,'USER_NOT_FOUND','User not found.');if(email)await pool.query(`UPDATE fleet_api_credentials SET email=$1 WHERE user_id=$2`,[email,req.params.id]);await audit(req.user.sub,'UPDATE_USER','user',req.params.id);return ok(res,r.rows[0],'User updated');}catch(e){return fail(res,400,'UPDATE_USER_ERROR','Unable to update user.');}});
router.patch('/:id/status',requireAuth,allowRoles('fleet_admin'),async(req,res)=>{const {status}=req.body;if(!['active','inactive'].includes(status))return fail(res,400,'INVALID_STATUS','Status must be active or inactive.');try{const r=await pool.query(`UPDATE fleet_api_credentials SET status=$1 WHERE user_id=$2 RETURNING user_id,status`,[status,req.params.id]);if(!r.rows[0])return fail(res,404,'CREDENTIAL_NOT_FOUND','Credential record not found.');await audit(req.user.sub,'CHANGE_USER_STATUS','user',req.params.id,{status});return ok(res,r.rows[0],'User status updated');}catch(e){return fail(res,400,'STATUS_ERROR','Unable to update user status.');}});
router.post('/register',async(req,res)=>{const {name,role,email,password='password'}=req.body;try{const r=await pool.query(`INSERT INTO users(name,role) VALUES($1,$2) RETURNING *`,[name,role]);await ensureCredential(r.rows[0],email,password);return ok(res,{...r.rows[0],email},'User registered',201);}catch(e){return fail(res,400,'REGISTER_ERROR','Unable to register user.');}});
module.exports=router;
