require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = require('../app');

async function connectDb() {
  const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_db',
    password: '1234',
    port: 5432,
    ssl: false
  });
  await pool.query('SELECT 1');
  return pool;
}

async function run() {
  const pool = await connectDb();
  const email = 'driver@gmail.com';
  const rawPassword = '12345678';

  // 1. Check or create driver account
  let userIdStr = null;
  let driverIdVal = null;
  let accountReused = false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credRes = await client.query(
      `SELECT c.user_id, c.email, u.role
       FROM fleet_api_credentials c
       JOIN users u ON CAST(u.user_id AS TEXT) = c.user_id
       WHERE lower(c.email) = lower($1)
       FOR UPDATE`,
      [email]
    );

    const passHash = await bcrypt.hash(rawPassword, 12);

    if (credRes.rows[0]) {
      accountReused = true;
      userIdStr = String(credRes.rows[0].user_id);
      await client.query(`UPDATE users SET role = 'driver' WHERE CAST(user_id AS TEXT) = $1`, [userIdStr]);
      await client.query(`UPDATE fleet_api_credentials SET password_hash = $1, status = 'active', updated_at = NOW() WHERE user_id = $2`, [passHash, userIdStr]);
    } else {
      const uRes = await client.query(`INSERT INTO users(name, role) VALUES('Test Driver', 'driver') RETURNING user_id`);
      userIdStr = String(uRes.rows[0].user_id);
      await client.query(`INSERT INTO fleet_api_credentials(user_id, email, password_hash, status) VALUES($1, $2, $3, 'active')`, [userIdStr, email, passHash]);
    }

    const drRes = await client.query(`SELECT driver_id FROM drivers WHERE CAST(user_id AS TEXT) = $1 LIMIT 1`, [userIdStr]);
    if (drRes.rows[0]) {
      driverIdVal = drRes.rows[0].driver_id;
      await client.query(`UPDATE drivers SET status = 'available' WHERE driver_id = $1`, [driverIdVal]);
    } else {
      const newDr = await client.query(`INSERT INTO drivers(user_id, status, license_number) VALUES($1, 'available', $2) RETURNING driver_id`, [userIdStr, `LIC-${userIdStr}`]);
      driverIdVal = newDr.rows[0].driver_id;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
    throw err;
  }
  client.release();

  // 2. Check existing trips for unassigned driver
  const tripsRes = await pool.query(
    `SELECT t.trip_id, t.reservation_id, t.driver_id AS trip_driver_id, r.driver_id AS res_driver_id, r.vehicle_id, r.status AS reservation_status
     FROM trips t
     JOIN reservations r ON r.reservation_id = t.reservation_id
     ORDER BY t.created_at DESC`
  );

  console.log('--- EXECUTED QUERY: INSPECTING EXISTING TRIPS ---');
  console.table(tripsRes.rows);

  let unassignedTrip = null;

  for (const t of tripsRes.rows) {
    const assigned = t.trip_driver_id ?? t.res_driver_id;
    if (assigned == null) {
      unassignedTrip = t;
      break;
    }
  }

  if (!unassignedTrip) {
    // Check if any trip is already assigned to THIS driver
    for (const t of tripsRes.rows) {
      const assigned = t.trip_driver_id ?? t.res_driver_id;
      if (String(assigned) === String(driverIdVal) || String(assigned) === String(userIdStr)) {
        unassignedTrip = t;
        break;
      }
    }
  }

  if (!unassignedTrip) {
    console.log('\n================================================================');
    console.log('STOP INSTRUCTION TRIGGERED: No existing unassigned trip found.');
    console.log('Existing trips already have assigned drivers. Stopping without overwriting.');
    console.log('================================================================\n');
    await pool.end();
    return {
      stopped: true,
      reason: 'No existing unassigned trip found.',
      driverUserId: userIdStr,
      driverRecordId: driverIdVal
    };
  }

  console.log(`\nUnassigned Trip Found: Trip ID ${unassignedTrip.trip_id}, Reservation ID ${unassignedTrip.reservation_id}`);

  // 3. Assign driver to unassigned trip
  await pool.query(`UPDATE trips SET driver_id = $1 WHERE trip_id = $2`, [driverIdVal, unassignedTrip.trip_id]);
  await pool.query(`UPDATE reservations SET driver_id = $1 WHERE reservation_id = $2`, [driverIdVal, unassignedTrip.reservation_id]);

  // 4. Verification via API
  const server = app.listen(3097);
  let loginPassed = false;
  let tripsMyPassed = false;
  let assignmentVerified = false;

  try {
    const loginRes = await fetch('http://localhost:3097/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: rawPassword })
    });
    const loginData = await loginRes.json();

    if (loginRes.status === 200 && loginData.success && loginData.data?.accessToken) {
      loginPassed = true;
      const token = loginData.data.accessToken;

      const myRes = await fetch('http://localhost:3097/api/v1/trips/my', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const myData = await myRes.json();

      if (myRes.status === 200 && myData.success && Array.isArray(myData.data)) {
        tripsMyPassed = true;
        const item = myData.data.find(x => String(x.trip_id) === String(unassignedTrip.trip_id));
        if (item && (String(item.driver_id) === String(driverIdVal) || String(item.driver_id) === String(userIdStr))) {
          assignmentVerified = true;
        }
      }
    }
  } finally {
    server.close();
    await pool.end();
  }

  const result = {
    stopped: false,
    driverUserId: userIdStr,
    driverRecordId: driverIdVal,
    assignedTripId: unassignedTrip.trip_id,
    reservationId: unassignedTrip.reservation_id,
    vehicleId: unassignedTrip.vehicle_id,
    tripStatus: unassignedTrip.reservation_status,
    login: loginPassed ? 'PASS' : 'FAIL',
    tripsMy: tripsMyPassed ? 'PASS' : 'FAIL',
    assignment: assignmentVerified ? 'PASS' : 'FAIL'
  };

  console.log('\n=== FINAL VERIFICATION RESULT ===');
  console.table(result);
  return result;
}

run().catch(err => {
  console.error('Script Error:', err);
  process.exit(1);
});
