const express=require('express');const {pool}=require('../config/db');const {ok,fail,userId}=require('../utils');const {requireAuth}=require('../middleware/auth');const router=express.Router();
router.get('/',requireAuth,async(req,res)=>{const r=await pool.query(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC`,[String(userId(req))]);return ok(res,r.rows);});
router.patch('/:notificationId/read',requireAuth,async(req,res)=>{const r=await pool.query(`UPDATE notifications SET is_read=true WHERE notification_id=$1 AND user_id=$2 RETURNING *`,[req.params.notificationId,String(userId(req))]);if(!r.rows[0])return fail(res,404,'NOTIFICATION_NOT_FOUND','Notification not found.');return ok(res,r.rows[0],'Notification marked as read');});
router.post('/read-all',requireAuth,async(req,res)=>{await pool.query(`UPDATE notifications SET is_read=true WHERE user_id=$1`,[String(userId(req))]);return ok(res,null,'All notifications marked as read');});
module.exports=router;
