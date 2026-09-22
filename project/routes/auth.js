const express=require('express');
const bcrypt=require('bcryptjs');
const {pool}=require('../config/db');
const {ok,fail,audit,userId}=require('../utils');
const {normalizeRole,signAccessToken,signRefreshToken,requireAuth}=require('../middleware/auth');
const router=express.Router();

router.post('/login',async(req,res)=>{
  const {email,password,name}=req.body;
  try{
    let cred;
    if(email) {
      const r=await pool.query(`SELECT c.*,u.name,u.role,u.user_id FROM fleet_api_credentials c JOIN users u ON CAST(u.user_id AS TEXT)=c.user_id WHERE lower(c.email)=lower($1)`,[email]);
      cred=r.rows[0];
    } else if(name) {
      const r=await pool.query(`SELECT c.*,u.name,u.role,u.user_id FROM fleet_api_credentials c JOIN users u ON CAST(u.user_id AS TEXT)=c.user_id WHERE lower(u.name)=lower($1)`,[name]);
      cred=r.rows[0];
    }
    if(!cred) return fail(res,401,'INVALID_CREDENTIALS','Invalid email/password.');
    if(cred.status!=='active') return fail(res,403,'USER_INACTIVE','User account is inactive.');
    if(!password || !(await bcrypt.compare(password,cred.password_hash))) return fail(res,401,'INVALID_CREDENTIALS','Invalid email/password.');
    const accessToken=signAccessToken(cred), refreshToken=signRefreshToken(cred);
    await audit(cred.user_id,'LOGIN','user',cred.user_id,{email:cred.email});
    return ok(res,{accessToken,refreshToken,user:{id:String(cred.user_id),name:cred.name,email:cred.email,role:normalizeRole(cred.role)}},'Login successful');
  }catch(e){console.error(e);return fail(res,500,'LOGIN_ERROR','Server error during login.');}
});
router.post('/refresh',async(req,res)=>{
  const jwt=require('jsonwebtoken'); const secret=process.env.JWT_SECRET||'dev-only-change-me';
  try{
    const p=jwt.verify(req.body.refreshToken,secret); if(p.type!=='refresh') throw new Error();
    const r=await pool.query(`SELECT u.* FROM users u WHERE CAST(u.user_id AS TEXT)=$1`,[String(p.sub)]);
    if(!r.rows[0]) return fail(res,401,'INVALID_REFRESH_TOKEN','User no longer exists.');
    return ok(res,{accessToken:signAccessToken(r.rows[0])},'Token refreshed');
  }catch{return fail(res,401,'INVALID_REFRESH_TOKEN','Refresh token is invalid or expired.');}
});
router.post('/logout',requireAuth,async(req,res)=>{await audit(userId(req),'LOGOUT','user',userId(req));return ok(res,null,'Logged out');});
router.get('/me',requireAuth,async(req,res)=>{
  const r=await pool.query(`SELECT u.* FROM users u WHERE CAST(u.user_id AS TEXT)=$1`,[String(req.user.sub)]);
  if(!r.rows[0]) return fail(res,404,'USER_NOT_FOUND','User not found.');
  const c=await pool.query(`SELECT email,status FROM fleet_api_credentials WHERE user_id=$1`,[String(req.user.sub)]);
  return ok(res,{id:String(r.rows[0].user_id),name:r.rows[0].name,email:c.rows[0]?.email||null,role:normalizeRole(r.rows[0].role),status:c.rows[0]?.status||'active'});
});
router.post('/change-password',requireAuth,async(req,res)=>{
  const {currentPassword,newPassword}=req.body;
  if(!newPassword||newPassword.length<6)return fail(res,400,'INVALID_PASSWORD','New password must be at least 6 characters.');
  const r=await pool.query(`SELECT * FROM fleet_api_credentials WHERE user_id=$1`,[String(req.user.sub)]);
  if(!r.rows[0]||!(await bcrypt.compare(currentPassword||'',r.rows[0].password_hash))) return fail(res,401,'INVALID_PASSWORD','Current password is incorrect.');
  await pool.query(`UPDATE fleet_api_credentials SET password_hash=$1,updated_at=NOW() WHERE user_id=$2`,[await bcrypt.hash(newPassword,12),String(req.user.sub)]);
  await audit(userId(req),'CHANGE_PASSWORD','user',userId(req)); return ok(res,null,'Password changed');
});
module.exports=router;
