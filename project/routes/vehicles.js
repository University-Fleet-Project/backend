// routes/vehicles.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // استدعاء سلك التوصيل الموحد بقاعدة البيانات

// 🔗 1. شاشة عرض كتالوج السيارات + الفلترة الذكية بحسب النوع (FLT-FR-01)
router.get('/', async (req, res) => {
    const { type } = req.query; // التقاط الفلتر المرسل من الموبايل (مثلاً: ?type=Van)

    try {
        let result;
        if (type) {
            // تفصيلة: لو الموبايل طالب نوع معين، بنفلتر جدول قاعدة البيانات بناءً عليه
            result = await pool.query('SELECT * FROM vehicles WHERE vehicle_type = $1 ORDER BY vehicle_id ASC;', [type]);
        } else {
            // تفصيلة: لو مبعتش أي فلتر، بنرجع كل العربيات كالعادة
            result = await pool.query('SELECT * FROM vehicles ORDER BY vehicle_id ASC;');
        }
        res.json(result.rows); // إرسال مصفوفة السيارات بالكامل إلى شاشة الفلاتر
    } catch (err) {
        console.error('Error fetching vehicle catalog:', err.message);
        res.status(500).json({ error: 'Server error while fetching vehicle catalog' });
    }
});

// 🔗 2. شاشة عرض تفاصيل عربية معينة بناءً على الـ ID بتاعها (FLT-FR-02)
router.get('/:id', async (req, res) => {
    const vehicleId = req.params.id; // التقاط رقم العربية من الرابط

    try {
        const result = await pool.query('SELECT * FROM vehicles WHERE vehicle_id = $1;', [vehicleId]);

        // تفصيلة: لو الرقم مش موجود في قاعدة البيانات
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vehicle not found in the system!' });
        }

        res.json(result.rows[0]); // إرجاع كائن السيارة مباشرة (عنصر واحد نضيف) لتطبيق الفلاتر
    } catch (err) {
        console.error('Error fetching vehicle details:', err.message);
        res.status(500).json({ error: 'Server error while fetching vehicle details' });
    }
});

module.exports = router; // ⚠️ السطر ده حاسم جداً ومهم عشان السيرفر الرئيسي يشوف الملف
