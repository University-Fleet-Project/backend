const express=require('express');
const {requireAuth,allowRoles}=require('../middleware/auth');
const users=require('./users');

const router=express.Router();

router.post('/accounts',requireAuth,allowRoles('fleet_admin'),users.handleCreateUser);

module.exports=router;
