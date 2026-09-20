// routes/reservations.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // استدعاء ملف الاتصال الموحد

// 🔗 1. حساب تقدير الوقود والتكلفة قبل الإرسال (لفتح خطوة الحساب في شاشات الموبايل)
router.post('/estimate', async (req, res) => {
    const { vehicle_id, distance_km } = req.body;
    try {
        const vehicleRes = await pool.query('SELECT nominal_l_per_100km FROM vehicles WHERE vehicle_id = \$1;', [vehicle_id]);
        if (vehicleRes.rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });

        const nominal = vehicleRes.rows[0].nominal_l_per_100km;
        const estimated_liters = (distance_km / 100) * nominal;
        const estimated_cost = estimated_liters * 15.00; // لتر الوقود بـ 15 جنيه كخط أساس ثابث

        res.json({
            estimated_liters: estimated_liters.toFixed(2),
            estimated_cost: estimated_cost.toFixed(2)
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error during fuel estimation' });
    }
});

// 🔗 2. جلب قائمة الحجوزات بالكامل للمدير والموظف (GET /reservations)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM reservations ORDER BY request_timestamp DESC;');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error while fetching reservations list' });
    }
});

// 🔗 3. تقديم طلب حجز جديد بحالته الرسمية الأولى pending (POST /reservations)
router.post('/', async (req, res) => {
    const { requester_id, vehicle_id, vehicle_type, start_time, end_time, origin, destination, distance_km, passengers, load_kg, purpose } = req.body;

    if (!requester_id || !vehicle_id || !start_time || !end_time || !distance_km || !origin || !destination) {
        return res.status(400).json({ error: 'Validation error: Missing required fields!' });
    }

    try {
        const vehicleRes = await pool.query('SELECT nominal_l_per_100km FROM vehicles WHERE vehicle_id = \$1;', [vehicle_id]);
        const nominal = vehicleRes.rows[0].nominal_l_per_100km;
        const estimated_liters = (distance_km / 100) * nominal;

        const query = `
            INSERT INTO reservations (reservation_id, vehicle_id, vehicle_type, trip_start_timestamp, trip_end_timestamp, origin, destination, route_km, estimated_fuel_liters, passengers, load_kg, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending') RETURNING *;
        `;
        // توليد معرف عشوائي للحجز لمحاكاة الـ UUID في الـ CSV
        const reservation_id = 'FLT-RES-' + Math.floor(1000 + Math.random() * 9000);
        const result = await pool.query(query, [reservation_id, vehicle_id, vehicle_type, start_time, end_time, origin, destination, distance_km, estimated_liters, passengers, load_kg]);
        res.status(201).json({ success: true, booking: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error while submitting reservation' });
    }
});

// 🔗 4. موافقة المدير وتعيين السائق وقفل الترباس الصارم لمنع التداخل (FOR UPDATE)
router.post('/approve/:id', async (req, res) => {
    const bookingId = req.params.id;
    const { vehicle_id, start_time, end_time, driver_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = \$1 FOR UPDATE;', [vehicle_id]);

        const checkOverlap = `
            SELECT reservation_id FROM reservations 
            WHERE vehicle_id = $1 AND status = 'approved' AND (trip_start_timestamp < $3 AND trip_end_timestamp > $2);
        `;
        const checkResult = await client.query(checkOverlap, [vehicle_id, start_time, end_time]);
        if (checkResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Concurrency conflict: Vehicle already allocated for an overlapping trip!' });
        }

        await client.query("UPDATE reservations SET status = 'approved', driver_id = \$1, approval_timestamp = NOW() WHERE reservation_id = \$2;", [driver_id, bookingId]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Reservation approved and vehicle allocated successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ error: 'Server error during approval processing' });
    } finally { client.release(); }
});

// 🔗 5. زرار الرفض (Reject) المخصص للمدير في لوحة التحكم
router.post('/reject/:id', async (req, res) => {
    const { reason } = req.body;
    try {
        await pool.query("UPDATE reservations SET status = 'rejected', rejection_reason = \$1 WHERE reservation_id = \$2;", [reason, req.params.id]);
        res.json({ success: true, message: 'Reservation rejected successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error during rejection' });
    }
});

// 🔗 6. زرار الإلغاء (Cancel) المخصص للموظف لرحلاته الشخصية
router.post('/cancel/:id', async (req, res) => {
    try {
        await pool.query("UPDATE reservations SET status = 'cancelled' WHERE reservation_id = \$1;", [req.params.id]);
        res.json({ success: true, message: 'Reservation cancelled successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error during cancellation' });
    }
});

module.exports = router;
