require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, bootstrapDatabase } = require('../config/db');
const app = require('../app');

const testAccounts = [
  { name: 'Requester Test User', role: 'requester', email: 'requester@gmail.com', password: '12345678', testEndpoint: '/api/v1/reservations/my' },
  { name: 'Dispatcher Test User', role: 'dispatcher', email: 'dispatcher@gmail.com', password: '12345678', testEndpoint: '/api/v1/dispatcher/reservations' },
  { name: 'Driver Test User', role: 'driver', email: 'driver@gmail.com', password: '12345678', testEndpoint: '/api/v1/trips/my' },
  { name: 'Fleet Admin Test User', role: 'fleet_admin', email: 'fleet_admin@gmail.com', password: '12345678', testEndpoint: '/api/v1/vehicles' },
  { name: 'Auditor Test User', role: 'auditor', email: 'auditor@gmail.com', password: '12345678', testEndpoint: '/api/v1/audit-logs' }
];

async function seedAndVerify() {
  await bootstrapDatabase();
  console.log('--- Seeding / Updating 5 Test Accounts ---');

  const results = [];

  for (const acc of testAccounts) {
    const client = await pool.connect();
    let actionType = 'inserted';
    let userIdStr = '';

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [acc.email]);

      const existingCred = await client.query(
        `SELECT c.user_id, c.email, u.role
         FROM fleet_api_credentials c
         JOIN users u ON CAST(u.user_id AS TEXT) = c.user_id
         WHERE lower(c.email) = lower($1)
         FOR UPDATE`,
        [acc.email]
      );

      const passwordHash = await bcrypt.hash(acc.password, 12);

      if (existingCred.rows[0]) {
        userIdStr = String(existingCred.rows[0].user_id);
        await client.query(
          `UPDATE users SET name = $1, role = $2 WHERE CAST(user_id AS TEXT) = $3`,
          [acc.name, acc.role, userIdStr]
        );
        await client.query(
          `UPDATE fleet_api_credentials SET password_hash = $1, status = 'active', updated_at = NOW() WHERE user_id = $2`,
          [passwordHash, userIdStr]
        );
        actionType = 'updated';
      } else {
        const uRes = await client.query(
          `INSERT INTO users(name, role) VALUES($1, $2) RETURNING user_id`,
          [acc.name, acc.role]
        );
        userIdStr = String(uRes.rows[0].user_id);
        await client.query(
          `INSERT INTO fleet_api_credentials(user_id, email, password_hash, status) VALUES($1, $2, $3, 'active')`,
          [userIdStr, acc.email, passwordHash]
        );
        actionType = 'inserted';
      }

      if (acc.role === 'driver') {
        const drExisting = await client.query(
          `SELECT driver_id FROM drivers WHERE user_id = $1 LIMIT 1`,
          [userIdStr]
        );
        if (!drExisting.rows[0]) {
          await client.query(
            `INSERT INTO drivers(user_id, status, license_number) VALUES($1, 'available', $2)`,
            [userIdStr, `LIC-${userIdStr}`]
          );
        } else {
          await client.query(
            `UPDATE drivers SET status = 'available' WHERE user_id = $1`,
            [userIdStr]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Error processing ${acc.email}:`, err);
      throw err;
    } finally {
      client.release();
    }

    results.push({ ...acc, userId: userIdStr, actionType });
  }

  console.log('--- Accounts Seeded Successfully. Verifying via Authentication & API Endpoints ---\n');

  const server = app.listen(3099);

  const reportRows = [];

  for (const item of results) {
    let loginPassed = false;
    let roleVerified = false;
    let endpointPassed = false;
    let token = null;

    try {
      // 1. Test Login
      const loginRes = await fetch('http://localhost:3099/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: item.email, password: item.password })
      });
      const loginData = await loginRes.json();

      if (loginRes.status === 200 && loginData.success && loginData.data?.accessToken) {
        loginPassed = true;
        token = loginData.data.accessToken;

        // 2. Decode JWT payload to verify role
        const decoded = jwt.decode(token);
        if (decoded && decoded.role === item.role) {
          roleVerified = true;
        }

        // 3. Test Role-Specific Read Endpoint
        const epRes = await fetch(`http://localhost:3099${item.testEndpoint}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (epRes.status === 200) {
          endpointPassed = true;
        }
      }
    } catch (err) {
      console.error(`Error testing ${item.email}:`, err.message);
    }

    reportRows.push({
      email: item.email,
      role: item.role,
      active: true,
      userId: item.userId,
      login: loginPassed ? 'PASS' : 'FAIL',
      roleVerified: roleVerified ? 'PASS' : 'FAIL',
      endpoint: endpointPassed ? 'PASS' : 'FAIL',
      wasUpdated: item.actionType === 'updated'
    });
  }

  server.close();

  console.log('--- TEST RESULTS TABLE ---');
  console.table(reportRows);

  await pool.end();
  return reportRows;
}

seedAndVerify().catch(err => {
  console.error('Fatal Seed/Verify Error:', err);
  process.exit(1);
});
