require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = require('../app');

async function connectDb() {
  let pool;
  try {
    pool = new Pool({
      user: 'postgres',
      host: 'localhost',
      database: 'fleet_db',
      password: '1234',
      port: 5432,
      ssl: false,
      connectionTimeoutMillis: 3000
    });
    await pool.query('SELECT 1');
    return pool;
  } catch (err) {
    if (process.env.DATABASE_URL) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      await pool.query('SELECT 1');
      return pool;
    }
    throw err;
  }
}

async function runDriverAssignment() {
  const pool = await connectDb();
  console.log('--- Step 1: Checking Driver Account (driver@gmail.com) ---');

  const email = 'driver@gmail.com';
  const rawPassword = '12345678';
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

  console.log(`Driver Account Ready -> user_id: ${userIdStr}, driver_id: ${driverIdVal}, accountReused: ${accountReused}`);

  console.log('\n--- Step 2: Inspecting Existing Trips ---');
  const tripsRes = await pool.query(
    `SELECT t.trip_id, t.reservation_id, t.driver_id AS trip_driver_id, r.driver_id AS res_driver_id, r.vehicle_id, r.status AS reservation_status
     FROM trips t
     JOIN reservations r ON r.reservation_id = t.reservation_id
     ORDER BY t.created_at DESC`
  );

  let targetTrip = null;

  if (tripsRes.rows.length === 0) {
    console.log('No existing trips found in database. Checking reservations to create an initial test trip...');
    let resRow = (await pool.query(`SELECT reservation_id, vehicle_id FROM reservations ORDER BY request_timestamp DESC LIMIT 1`)).rows[0];
    if (!resRow) {
      const vRow = (await pool.query(`SELECT vehicle_id FROM vehicles LIMIT 1`)).rows[0];
      const newRes = await pool.query(
        `INSERT INTO reservations(reservation_id, vehicle_id, status, request_timestamp) VALUES('FLT-RES-TEST-01', $1, 'approved', NOW()) RETURNING reservation_id, vehicle_id`,
        [vRow ? vRow.vehicle_id : 'FLT-V-001']
      );
      resRow = newRes.rows[0];
    }
    const newTrip = await pool.query(
      `INSERT INTO trips(reservation_id, start_odometer, created_at) VALUES($1, 1000, NOW()) RETURNING trip_id`,
      [resRow.reservation_id]
    );
    targetTrip = {
      trip_id: newTrip.rows[0].trip_id,
      reservation_id: resRow.reservation_id,
      trip_driver_id: null,
      res_driver_id: null,
      vehicle_id: resRow.vehicle_id
    };
  } else {
    // Find an unassigned trip or trip already assigned to this driver
    for (const t of tripsRes.rows) {
      const currentDriver = t.trip_driver_id ?? t.res_driver_id;
      if (currentDriver == null || String(currentDriver) === String(driverIdVal) || String(currentDriver) === String(userIdStr)) {
        targetTrip = t;
        break;
      }
    }

    if (!targetTrip) {
      const firstTrip = tripsRes.rows[0];
      const existingDriver = firstTrip.trip_driver_id ?? firstTrip.res_driver_id;
      console.log(`\nSTOP INSTRUCTION TRIGGERED: Trip ${firstTrip.trip_id} already has driver_id: ${existingDriver}.`);
      console.log(`Reporting trip ID: ${firstTrip.trip_id}, current driver: ${existingDriver}`);
      await pool.end();
      return {
        stopped: true,
        tripId: firstTrip.trip_id,
        existingDriver,
        driverUserId: userIdStr,
        driverRecordId: driverIdVal
      };
    }
  }

  console.log(`Selected Target Trip ID: ${targetTrip.trip_id}, Reservation ID: ${targetTrip.reservation_id}`);

  // Step 3: Assign driver to trip
  console.log('\n--- Step 3: Assigning Driver to Trip ---');
  await pool.query(`UPDATE trips SET driver_id = $1 WHERE trip_id = $2`, [driverIdVal, targetTrip.trip_id]);
  await pool.query(`UPDATE reservations SET driver_id = $1 WHERE reservation_id = $2`, [driverIdVal, targetTrip.reservation_id]);
  console.log(`Trip ${targetTrip.trip_id} updated with driver_id: ${driverIdVal}`);

  // Step 4: Verification via API
  console.log('\n--- Step 4: Verifying via Login & GET /api/v1/trips/my ---');
  const server = app.listen(3098);
  let loginPassed = false;
  let tripsMyPassed = false;
  let assignmentVerified = false;

  try {
    const loginRes = await fetch('http://localhost:3098/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: rawPassword })
    });
    const loginData = await loginRes.json();

    if (loginRes.status === 200 && loginData.success && loginData.data?.accessToken) {
      loginPassed = true;
      const token = loginData.data.accessToken;

      const myRes = await fetch('http://localhost:3098/api/v1/trips/my', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const myData = await myRes.json();

      if (myRes.status === 200 && myData.success && Array.isArray(myData.data)) {
        tripsMyPassed = true;
        const assignedItem = myData.data.find(t => String(t.trip_id) === String(targetTrip.trip_id));
        if (assignedItem && (String(assignedItem.driver_id) === String(driverIdVal) || String(assignedItem.driver_id) === String(userIdStr))) {
          assignmentVerified = true;
        }
      }
    }
  } catch (err) {
    console.error('Verification error:', err.message);
  } finally {
    server.close();
    await pool.end();
  }

  const finalReport = {
    stopped: false,
    driverUserId: userIdStr,
    driverRecordId: driverIdVal,
    tripIdAssigned: targetTrip.trip_id,
    login: loginPassed ? 'PASS' : 'FAIL',
    tripsMy: tripsMyPassed ? 'PASS' : 'FAIL',
    assignmentVerification: assignmentVerified ? 'PASS' : 'FAIL',
    accountReused
  };

  console.log('\n=== FINAL VERIFICATION REPORT ===');
  console.table(finalReport);
  return finalReport;
}

runDriverAssignment().catch(err => {
  console.error('Fatal Script Error:', err);
  process.exit(1);
});
