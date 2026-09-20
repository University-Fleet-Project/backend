// routes/users.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 🔑 1. رابط تسجيل الدخول والتحقق من الاسم بدقة الصلاحيات
router.post('/login', async (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Please enter your university name to login!' });
    }

    try {
        const queryText = 'SELECT * FROM users WHERE name = \$1;';
        const result = await pool.query(queryText, [name]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'This name is not registered in the university fleet system!' });
        }

        const user = result.rows[0];

        res.json({
            success: true,
            message: `Welcome ${user.name}. Authentication successful.`,
            user: {
                user_id: user.user_id,
                name: user.name,
                role: user.role // يخرج القيمة المخزنة الدقيقة (مثل Fleet dispatcher) لشاشات عبده
            }
        });
    } catch (err) {
        console.error('Error in login route:', err.message);
        res.status(500).json({ error: 'Server error during account verification' });
    }
});

// 📝 2. رابط إنشاء أكاونت جديد يدعم الأدوار الموسعة الدقيقة المطلوبة في التطبيق
router.post('/register', async (req, res) => {
    const { name, role } = req.body;

    if (!name || !role) {
        return res.status(400).json({ error: 'Please provide both name and role to register!' });
    }

    // دعم كامل للأدوار المطلوبة في السيستم والـ UI لحل مشكلة توقف الشاشات
    const allowedRoles = ['Requester', 'Fleet dispatcher', 'Driver', 'Fleet manager', 'Auditor'];
    if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role selection!' });
    }

    try {
        const queryText = 'INSERT INTO users (name, role) VALUES (\$1, \$2) RETURNING *;';
        const result = await pool.query(queryText, [name, role]);

        res.status(201).json({
            success: true,
            message: 'User registered and saved in database successfully!',
            user: result.rows[0]
        });
    } catch (err) {
        console.error('Error in register route:', err.message);
        res.status(500).json({ error: 'Server error while registering new user' });
    }
});

module.exports = router;
