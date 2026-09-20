// routes/trips.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // استدعاء سلك التوصيل الموحد

// 🔗 1. ضغطة السائق "بدء الرحلة": تسجيل عداد الانطلاق وإرجاع الـ trip_id صراحة (FLT-FR-07)
router.post('/start', async (req, res) => {
    const { reservation_id, driver_id, start_odometer } = req.body;

    if (!reservation_id || !driver_id || !start_odometer) {
        return res.status(400).json({ error: 'Validation error: Missing trip activation data!' });
    }

    try {
        // إدخال سطر جديد في جدول الـ trips وحفظ سجل الانطلاق
        const insertTripQuery = `
          INSERT INTO trips (reservation_id, driver_id, start_odometer)
          VALUES ($1, $2, $3) 
          RETURNING *;
        `;
        const tripResult = await pool.query(insertTripQuery, [reservation_id, driver_id, start_odometer]);
        const newTrip = tripResult.rows[0];

        // تحديث حالة الحجز الأصلي بالحروف الصغيرة الدقيقة المتوقعة في الفلاتر (active)
        await pool.query("UPDATE reservations SET status = 'active' WHERE reservation_id = \$1;", [reservation_id]);

        res.status(201).json({
            success: true,
            trip_id: newTrip.trip_id, // إرجاع المعرف صراحة في المستوى الأول لفتح شاشات التتبع
            message: 'Trip started successfully! Operational state is now active.',
            trip: newTrip
        });
    } catch (err) {
        console.error('Error starting trip:', err.message);
        res.status(500).json({ error: 'Server error while activating the trip' });
    }
});

// 🔗 2. ضغطة السائق "إنهاء الرحلة": تسجيل المسافة والوقود الفعلي للمقارنة والـ AI (FLT-FR-09)
router.post('/complete/:id', async (req, res) => {
    const tripId = req.params.id; // الـ trip_id من المسار
    const { end_odometer, actual_distance_km, actual_fuel_used_liters, reservation_id } = req.body;

    if (!end_odometer || !actual_distance_km || !actual_fuel_used_liters || !reservation_id) {
        return res.status(400).json({ error: 'Validation error: Missing trip completion records!' });
    }

    try {
        // تحديث السجل الفعلي في جدول الـ trips وحفظ المسافة والوقود النهائي
        const updateTripQuery = `
          UPDATE trips 
          SET end_odometer = $1, actual_distance_km = $2, actual_fuel_used_liters = $3
          WHERE trip_id = $4 
          RETURNING *;
        `;
        const tripResult = await pool.query(updateTripQuery, [end_odometer, actual_distance_km, actual_fuel_used_liters, tripId]);

        // تحديث حالة الحجز الأصلي في قاعدة البيانات إلى حروف صغيرة (completed) مع حفظ وقود التيليميتري الفعلي
        await pool.query(
            "UPDATE reservations SET status = 'completed', actual_fuel_liters = \$1, trip_end_timestamp = NOW() WHERE reservation_id = \$2;",
            [actual_fuel_used_liters, reservation_id]
        );

        res.json({
            success: true,
            message: 'Trip completed safely! Telemetry logged for variance dashboards.',
            completed_trip: tripResult.rows[0]
        });
    } catch (err) {
        console.error('Error completing trip:', err.message);
        res.status(500).json({ error: 'Server error while closing the trip record' });
    }
});

module.exports = router;
