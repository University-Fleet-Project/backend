require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool, bootstrapDatabase } = require('../config/db');

const email = String(process.env.SEED_FLEET_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.SEED_FLEET_ADMIN_PASSWORD;

async function seedFleetAdmin() {
  if (!email || !password) {
    throw new Error(
      'SEED_FLEET_ADMIN_EMAIL and SEED_FLEET_ADMIN_PASSWORD are required.'
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);

    const existing = await client.query(
      `SELECT c.user_id
       FROM fleet_api_credentials c
       WHERE lower(c.email) = $1
       FOR UPDATE`,
      [email]
    );

    const passwordHash = await bcrypt.hash(password, 12);
    let userId;
    let action;

    if (existing.rows[0]) {
      userId = String(existing.rows[0].user_id);
      await client.query(
        `UPDATE users
         SET role = 'fleet_admin'
         WHERE CAST(user_id AS TEXT) = $1`,
        [userId]
      );
      await client.query(
        `UPDATE fleet_api_credentials
         SET password_hash = $1, status = 'active', updated_at = NOW()
         WHERE user_id = $2`,
        [passwordHash, userId]
      );
      action = 'upserted';
    } else {
      const user = await client.query(
        `INSERT INTO users(name, role)
         VALUES($1, 'fleet_admin')
         RETURNING user_id`,
        ['Fleet Administrator']
      );
      userId = String(user.rows[0].user_id);
      await client.query(
        `INSERT INTO fleet_api_credentials(user_id, email, password_hash, status)
         VALUES($1, $2, $3, 'active')`,
        [userId, email, passwordHash]
      );
      action = 'created';
    }

    await client.query('COMMIT');
    console.log(`Fleet admin account ${action}.`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function seedAnalyticsDemo() {
  if (process.env.SEED_ANALYTICS_DEMO !== 'true') return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alreadySeeded = await client.query(`SELECT 1 FROM maintenance_records WHERE description='Analytics demo maintenance' LIMIT 1`);
    if (alreadySeeded.rows[0]) {
      await client.query('COMMIT');
      console.log('Analytics demo seed completed: 0 linked trips created.');
      return 0;
    }
    const driverUser = await client.query(`SELECT user_id FROM users WHERE lower(role)='driver' ORDER BY user_id LIMIT 1`);
    if (!driverUser.rows[0]) throw new Error('A driver user is required before analytics demo data can be seeded.');
    const userId = String(driverUser.rows[0].user_id);
    let driver = await client.query(`SELECT driver_id FROM drivers WHERE user_id=$1 ORDER BY driver_id LIMIT 1 FOR UPDATE`, [userId]);
    if (!driver.rows[0]) driver = await client.query(`INSERT INTO drivers(user_id,status,license_number) VALUES($1,'available',$2) RETURNING driver_id`, [userId, `DEMO-${userId}`]);
    const driverId = driver.rows[0].driver_id;
    await client.query(`INSERT INTO driver_qualifications(driver_id,qualification,status) SELECT $1,'Demo Fleet Qualification','valid' WHERE NOT EXISTS(SELECT 1 FROM driver_qualifications WHERE driver_id=$1 AND qualification='Demo Fleet Qualification')`, [driverId]);
    const reservations = await client.query(`SELECT DISTINCT ON (r.vehicle_id) r.reservation_id,r.vehicle_id,r.trip_start_timestamp,r.trip_end_timestamp,r.route_km,COALESCE(r.actual_fuel_liters,r.estimated_fuel_liters) actual_fuel_liters,v.nominal_l_per_100km FROM reservations r JOIN vehicles v ON v.vehicle_id=r.vehicle_id LEFT JOIN trips t ON t.reservation_id=r.reservation_id WHERE r.status='completed' AND t.trip_id IS NULL AND r.route_km IS NOT NULL ORDER BY r.vehicle_id,r.trip_start_timestamp LIMIT 6`);
    let created = 0;
    for (let index = 0; index < reservations.rows.length; index += 1) {
      const r = reservations.rows[index];
      const distance = Number(r.route_km);
      const fuel = Number(r.actual_fuel_liters || (distance * Number(r.nominal_l_per_100km || 0) / 100));
      const start = 10000 + index * 1000;
      const end = start + distance;
      const trip = await client.query(`INSERT INTO trips(reservation_id,driver_id,start_odometer,end_odometer,actual_distance_km,actual_fuel_used_liters,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING trip_id`, [r.reservation_id, driverId, start, end, distance, fuel, r.trip_start_timestamp]);
      const tripId = trip.rows[0].trip_id;
      const price = Number(process.env.FUEL_PRICE_EGP || 15);
      await client.query(`INSERT INTO fuel_transactions(trip_id,liters,cost,odometer,recorded_at) VALUES($1,$2,$3,$4,$5)`, [tripId, fuel, fuel * price, end, r.trip_end_timestamp]);
      await client.query(`INSERT INTO odometer_readings(vehicle_id,value,recorded_at,recorded_by) VALUES($1,$2,$3,$4),($1,$5,$6,$4)`, [r.vehicle_id, start, r.trip_start_timestamp, userId, end, r.trip_end_timestamp]);
      await client.query(`UPDATE vehicles SET current_odometer=GREATEST(COALESCE(current_odometer,0),$1) WHERE vehicle_id=$2`, [end, r.vehicle_id]);
      await client.query(`INSERT INTO route_estimates(reservation_id,origin,destination,distance_km,duration_minutes,provider,snapshot) SELECT $1::varchar,jsonb_build_object('source','seed'),jsonb_build_object('source','seed'),$2::numeric,$3::numeric,'baseline',jsonb_build_object('source','analytics-demo') WHERE NOT EXISTS(SELECT 1 FROM route_estimates WHERE reservation_id=$1::varchar)`, [r.reservation_id, distance, Math.round(distance / 40 * 60)]);
      const estimated = distance * Number(r.nominal_l_per_100km || 0) / 100;
      await client.query(`INSERT INTO fuel_estimates(reservation_id,vehicle_id,route_distance_km,estimated_liters,estimated_cost,method,min_liters,max_liters,confidence,assumptions,fallback_used) SELECT $1::varchar,$2::varchar,$3::numeric,$4::numeric,$5::numeric,'baseline',$6::numeric,$7::numeric,$8::numeric,$9::jsonb,true WHERE NOT EXISTS(SELECT 1 FROM fuel_estimates WHERE reservation_id=$1::varchar)`, [r.reservation_id, r.vehicle_id, distance, estimated, estimated * price, estimated * .88, estimated * 1.18, .72, JSON.stringify(['Derived from completed reservation and vehicle nominal consumption'])]);
      await client.query(`INSERT INTO maintenance_records(vehicle_id,maintenance_type,description,start_at,end_at,status) SELECT $1::varchar,'Inspection','Analytics demo maintenance',$2::timestamp,$3::timestamp,'completed' WHERE NOT EXISTS(SELECT 1 FROM maintenance_records WHERE vehicle_id=$1::varchar AND description='Analytics demo maintenance')`, [r.vehicle_id, r.trip_end_timestamp, r.trip_end_timestamp]);
      created += 1;
    }
    await client.query('COMMIT');
    console.log(`Analytics demo seed completed: ${created} linked trips created.`);
    return created;
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; } finally { client.release(); }
}

async function seedDemoUsers() {
  const demoAccounts = [
    { name: 'Fleet Dispatcher Demo', role: 'dispatcher', email: 'dispatcher@fleet.demo', password: 'password' },
    { name: 'Fleet Auditor Demo', role: 'auditor', email: 'auditor@fleet.demo', password: 'password' }
  ];

  const client = await pool.connect();
  try {
    for (const acc of demoAccounts) {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT c.user_id FROM fleet_api_credentials c WHERE lower(c.email) = $1 FOR UPDATE`,
        [acc.email]
      );
      const passwordHash = await bcrypt.hash(acc.password, 12);
      if (existing.rows[0]) {
        const userId = String(existing.rows[0].user_id);
        await client.query(`UPDATE users SET role = $1 WHERE CAST(user_id AS TEXT) = $2`, [acc.role, userId]);
        await client.query(
          `UPDATE fleet_api_credentials SET password_hash = $1, status = 'active', updated_at = NOW() WHERE user_id = $2`,
          [passwordHash, userId]
        );
      } else {
        const user = await client.query(
          `INSERT INTO users(name, role) VALUES($1, $2) RETURNING user_id`,
          [acc.name, acc.role]
        );
        const userId = String(user.rows[0].user_id);
        await client.query(
          `INSERT INTO fleet_api_credentials(user_id, email, password_hash, status) VALUES($1, $2, $3, 'active')`,
          [userId, acc.email, passwordHash]
        );
      }
      await client.query('COMMIT');
    }
    console.log('Demo accounts (dispatcher@fleet.demo, auditor@fleet.demo) seeded.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Error seeding demo accounts:', error.message);
  } finally {
    client.release();
  }
}

async function seedVehiclePhotos() {
  const samplePhotos = {
    car: [
      { url: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341', caption: 'Front exterior view' },
      { url: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d', caption: 'Side profile angle' },
      { url: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738', caption: 'Front 3/4 fleet angle' }
    ],
    van: [
      { url: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf', caption: 'Passenger van front view' },
      { url: 'https://images.unsplash.com/photo-1563720223185-11003d516935', caption: 'Side profile van' }
    ],
    bus: [
      { url: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e', caption: 'Campus shuttle bus' },
      { url: 'https://images.unsplash.com/photo-1557223562-6c77ef16210f', caption: 'Fleet passenger bus' }
    ]
  };

  const client = await pool.connect();
  try {
    const vehicles = await client.query(`SELECT vehicle_id, vehicle_type FROM vehicles ORDER BY vehicle_id`);
    let addedCount = 0;

    for (const v of vehicles.rows) {
      const typeKey = (v.vehicle_type || '').toLowerCase().includes('van') ? 'van'
        : (v.vehicle_type || '').toLowerCase().includes('bus') ? 'bus'
        : 'car';
      const photos = samplePhotos[typeKey] || samplePhotos.car;

      for (let i = 0; i < photos.length; i += 1) {
        const item = photos[i];
        const existing = await client.query(
          `SELECT 1 FROM vehicle_photos WHERE vehicle_id = $1 AND (url = $2 OR image_url = $2) LIMIT 1`,
          [v.vehicle_id, item.url]
        );
        if (!existing.rows[0]) {
          await client.query(
            `INSERT INTO vehicle_photos(vehicle_id, url, image_url, caption, created_at) VALUES($1, $2, $2, $3, NOW())`,
            [v.vehicle_id, item.url, item.caption]
          );
          addedCount += 1;
        }
      }
    }
    console.log(`Demo vehicle photos seeded: ${addedCount} new photo records added.`);
  } catch (error) {
    console.error('Error seeding vehicle photos:', error.message);
  } finally {
    client.release();
  }
}

(async () => {
  try {
    await bootstrapDatabase();
    await seedDemoUsers();
    await seedVehiclePhotos();
    if (email || password) await seedFleetAdmin();
    await seedAnalyticsDemo();
    if (!email && !password && process.env.SEED_ANALYTICS_DEMO !== 'true') throw new Error('Provide fleet-admin seed variables or set SEED_ANALYTICS_DEMO=true.');
    await pool.end();
  } catch (error) {
    console.error('Fleet admin seed failed:', error.message);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  }
})();
