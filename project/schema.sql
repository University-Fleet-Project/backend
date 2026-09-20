CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id SERIAL PRIMARY KEY,
    vehicle_type VARCHAR(50) NOT NULL,
    nominal_l_per_100km NUMERIC(6,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
    reservation_id VARCHAR(50) PRIMARY KEY,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(vehicle_id),
    vehicle_type VARCHAR(50) NOT NULL,
    trip_start_timestamp TIMESTAMP NOT NULL,
    trip_end_timestamp TIMESTAMP NOT NULL,
    origin VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    route_km NUMERIC(10,2) NOT NULL,
    estimated_fuel_liters NUMERIC(10,2) NOT NULL,
    passengers INTEGER DEFAULT 0,
    load_kg NUMERIC(10,2) DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    driver_id INTEGER REFERENCES users(user_id),
    approval_timestamp TIMESTAMP,
    rejection_reason TEXT,
    actual_fuel_liters NUMERIC(10,2),
    request_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trips (
    trip_id SERIAL PRIMARY KEY,
    reservation_id VARCHAR(50) NOT NULL REFERENCES reservations(reservation_id),
    driver_id INTEGER NOT NULL REFERENCES users(user_id),
    start_odometer NUMERIC(10,2) NOT NULL,
    end_odometer NUMERIC(10,2),
    actual_distance_km NUMERIC(10,2),
    actual_fuel_used_liters NUMERIC(10,2)
);