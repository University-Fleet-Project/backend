require('dotenv').config();

const pool = require('../config/db');

async function seed() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Reset demo data
        await client.query(`
            TRUNCATE TABLE trips, reservations, vehicles, users
            RESTART IDENTITY CASCADE
        `);

        // Users
        await client.query(`
            INSERT INTO users (name, role) VALUES
            ('Ahmed Ali', 'Requester'),
            ('Mariam Hassan', 'Fleet dispatcher'),
            ('Omar Khaled', 'Driver'),
            ('Nour Mohamed', 'Fleet manager'),
            ('Youssef Adel', 'Auditor')
        `);

        // Vehicles
        await client.query(`
            INSERT INTO vehicles (vehicle_type, nominal_l_per_100km) VALUES
            ('Sedan', 7.50),
            ('Van', 10.50),
            ('Bus', 18.00),
            ('SUV', 11.00)
        `);

        // Reservations
        await client.query(`
            INSERT INTO reservations (
                reservation_id,
                vehicle_id,
                vehicle_type,
                trip_start_timestamp,
                trip_end_timestamp,
                origin,
                destination,
                route_km,
                estimated_fuel_liters,
                passengers,
                load_kg,
                status,
                driver_id,
                approval_timestamp,
                actual_fuel_liters
            ) VALUES

            (
                'FLT-RES-1001',
                1,
                'Sedan',
                '2026-09-21 09:00:00',
                '2026-09-21 11:00:00',
                'BUA Main Campus',
                'Assiut Train Station',
                30.00,
                2.25,
                3,
                50.00,
                'pending',
                NULL,
                NULL,
                NULL
            ),

            (
                'FLT-RES-1002',
                2,
                'Van',
                '2026-09-21 12:00:00',
                '2026-09-21 15:00:00',
                'BUA Main Campus',
                'Assiut University',
                45.00,
                4.73,
                6,
                120.00,
                'approved',
                3,
                CURRENT_TIMESTAMP,
                NULL
            ),

            (
                'FLT-RES-1003',
                3,
                'Bus',
                '2026-09-20 08:00:00',
                '2026-09-20 13:00:00',
                'BUA Main Campus',
                'New Assiut City',
                80.00,
                14.40,
                25,
                300.00,
                'active',
                3,
                CURRENT_TIMESTAMP,
                NULL
            ),

            (
                'FLT-RES-1004',
                4,
                'SUV',
                '2026-09-19 10:00:00',
                '2026-09-19 14:00:00',
                'BUA Main Campus',
                'Assiut Industrial Zone',
                60.00,
                6.60,
                4,
                80.00,
                'completed',
                3,
                CURRENT_TIMESTAMP,
                7.10
            )
        `);

        // Trips
        await client.query(`
            INSERT INTO trips (
                reservation_id,
                driver_id,
                start_odometer,
                end_odometer,
                actual_distance_km,
                actual_fuel_used_liters
            ) VALUES

            (
                'FLT-RES-1003',
                3,
                15200.00,
                NULL,
                NULL,
                NULL
            ),

            (
                'FLT-RES-1004',
                3,
                15000.00,
                15063.50,
                63.50,
                7.10
            )
        `);

        await client.query('COMMIT');

        console.log('✅ Demo data seeded successfully!');
        console.log('👤 Users: 5');
        console.log('🚗 Vehicles: 4');
        console.log('📅 Reservations: 4');
        console.log('🛣️ Trips: 2');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Seed failed:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seed();