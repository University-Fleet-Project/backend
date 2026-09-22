const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({
  path: path.resolve(process.cwd(), '.env'),
});

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || process.env.DB_DATABASE || 'fleet_db',
  password: String(process.env.DB_PASSWORD ?? '1234'),
  port: Number(process.env.DB_PORT || 5432),
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
});

async function bootstrapDatabase() {
  const client = await pool.connect();

  try {
    await client.query('SELECT 1');

    await client.query(`
      CREATE TABLE IF NOT EXISTS fleet_api_credentials (
        user_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fleet_brands (
        brand_id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fleet_models (
        model_id SERIAL PRIMARY KEY,
        brand_id INTEGER REFERENCES fleet_brands(brand_id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vehicle_specifications (
        vehicle_id VARCHAR(50) PRIMARY KEY,
        nominal_l_per_100km NUMERIC,
        tank_capacity_l NUMERIC,
        accessibility TEXT,
        transmission TEXT,
        allowed_load_kg NUMERIC,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drivers (
        driver_id SERIAL PRIMARY KEY,
        user_id TEXT,
        status TEXT NOT NULL DEFAULT 'available',
        license_number TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS driver_qualifications (
        qualification_id SERIAL PRIMARY KEY,
        driver_id INTEGER NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
        qualification TEXT NOT NULL,
        valid_from DATE,
        valid_to DATE,
        status TEXT NOT NULL DEFAULT 'valid'
      );

      CREATE TABLE IF NOT EXISTS maintenance_records (
        maintenance_id SERIAL PRIMARY KEY,
        vehicle_id VARCHAR(50) NOT NULL,
        maintenance_type TEXT,
        description TEXT,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vehicle_photos (
        photo_id SERIAL PRIMARY KEY,
        vehicle_id VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        caption TEXT
      );

      CREATE TABLE IF NOT EXISTS reservation_status_history (
        history_id SERIAL PRIMARY KEY,
        reservation_id VARCHAR(50) NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        changed_by TEXT,
        reason TEXT,
        changed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS route_estimates (
        route_id SERIAL PRIMARY KEY,
        reservation_id VARCHAR(50),
        origin JSONB,
        destination JSONB,
        distance_km NUMERIC,
        duration_minutes NUMERIC,
        provider TEXT NOT NULL DEFAULT 'mock',
        snapshot JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fuel_estimates (
        estimate_id SERIAL PRIMARY KEY,
        reservation_id VARCHAR(50),
        vehicle_id VARCHAR(50),
        route_distance_km NUMERIC,
        estimated_liters NUMERIC,
        estimated_cost NUMERIC,
        method TEXT NOT NULL DEFAULT 'baseline',
        model_version TEXT,
        min_liters NUMERIC,
        max_liters NUMERIC,
        confidence NUMERIC,
        assumptions JSONB,
        fallback_used BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trip_status_history (
        history_id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        changed_by TEXT,
        reason TEXT,
        changed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS location_pings (
        ping_id BIGSERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL,
        latitude NUMERIC NOT NULL,
        longitude NUMERIC NOT NULL,
        recorded_at TIMESTAMP NOT NULL,
        accuracy_meters NUMERIC,
        speed_kmh NUMERIC,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fuel_transactions (
        fuel_transaction_id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL,
        liters NUMERIC NOT NULL,
        cost NUMERIC NOT NULL,
        odometer NUMERIC,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS odometer_readings (
        odometer_id SERIAL PRIMARY KEY,
        vehicle_id VARCHAR(50) NOT NULL,
        value NUMERIC NOT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        recorded_by TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        audit_id BIGSERIAL PRIMARY KEY,
        actor_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fuel_model_registry (
        model_version TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'inactive',
        mae_liters NUMERIC,
        mape NUMERIC,
        baseline_mae_liters NUMERIC,
        improvement NUMERIC,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_vehicle_window
      ON reservations(vehicle_id, trip_start_timestamp, trip_end_timestamp);

      CREATE INDEX IF NOT EXISTS idx_reservations_requester
      ON reservations(requester_id);

      CREATE INDEX IF NOT EXISTS idx_reservations_driver
      ON reservations(driver_id);

      CREATE INDEX IF NOT EXISTS idx_trips_reservation
      ON trips(reservation_id);
    `);

    console.log(
      'PostgreSQL connected; non-destructive Fleet API support schema ready.'
    );
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  bootstrapDatabase,
};
