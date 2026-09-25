const express = require('express');
const { pool } = require('../config/db');
const { ok, fail, pagination, paged } = require('../utils');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Call the AI Fuel Prediction API with retry and timeout protection.
 * Render free tier services sleep after inactivity, which can cause initial cold-start delays.
 * A 2-attempt retry loop with a 12-second timeout per attempt ensures reliable responses.
 */
async function callAiPredictApi(aiPayload) {
  const rawUrl = process.env.AI_FUEL_API_URL || 'https://ai-api-3d94.onrender.com/predict';
  const aiUrl = String(rawUrl).trim();
  const maxRetries = Math.max(1, Number(process.env.AI_FUEL_MAX_RETRIES || 2));
  const timeoutMs = Math.max(1000, Number(process.env.AI_FUEL_TIMEOUT_MS || 12000));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startMs = Date.now();

    try {
      console.log(`[AI Fuel] Calling AI API (attempt ${attempt}/${maxRetries}): ${aiUrl}`);
      const response = await fetch(aiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(aiPayload),
        signal: controller.signal
      });
      clearTimeout(timer);

      const elapsedMs = Date.now() - startMs;
      if (response.ok) {
        const data = await response.json();
        const rawLiters = data?.predicted_fuel_liters ?? data?.predictedFuelLiters ?? data?.predicted_fuel;
        const numLiters = Number(rawLiters);

        if (
          data &&
          (data.status === 'success' || data.status === 'ok') &&
          !isNaN(numLiters) &&
          numLiters > 0
        ) {
          console.log(`[AI Fuel] Success on attempt ${attempt} (${elapsedMs} ms): ${numLiters} L`);
          return {
            success: true,
            predicted_fuel_liters: numLiters,
            model_version: data.model_version || data.modelVersion || null
          };
        } else {
          console.warn(`[AI Fuel] Unexpected response structure on attempt ${attempt}:`, data);
        }
      } else {
        console.warn(`[AI Fuel] HTTP status ${response.status} from AI API on attempt ${attempt} (${elapsedMs} ms)`);
      }
    } catch (err) {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startMs;
      console.warn(`[AI Fuel] Attempt ${attempt} failed (${elapsedMs} ms): ${err.message}`);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return { success: false };
}

router.post('/estimate', requireAuth, async (req, res) => {
  const b = req.body;
  const vehicleId = b.vehicleId || b.vehicle_id;
  if (!vehicleId) {
    return fail(res, 400, 'VALIDATION_ERROR', 'vehicleId is required.');
  }

  try {
    // 1. Fetch full vehicle data from PostgreSQL (with specification fallback)
    const vQuery = await pool.query(
      `SELECT v.vehicle_id, v.vehicle_type, v.make, v.model, v.vehicle_year, v.seats, v.fuel_type,
              COALESCE(v.nominal_l_per_100km, s.nominal_l_per_100km, 0) AS nominal_l_per_100km,
              COALESCE(v.allowed_load_kg, s.allowed_load_kg, 0) AS allowed_load_kg
       FROM vehicles v
       LEFT JOIN vehicle_specifications s ON v.vehicle_id = s.vehicle_id
       WHERE v.vehicle_id = $1`,
      [vehicleId]
    );

    if (!vQuery.rows[0]) {
      return fail(res, 404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.');
    }
    const vehicle = vQuery.rows[0];

    // 2. Fetch reservation details if reservationId is supplied
    const reservationId = b.reservationId || b.reservation_id || null;
    let reservation = null;
    if (reservationId) {
      const rQuery = await pool.query(
        `SELECT passengers, load_kg, trip_start_timestamp, trip_end_timestamp, route_km
         FROM reservations WHERE reservation_id = $1`,
        [reservationId]
      );
      if (rQuery.rows[0]) {
        reservation = rQuery.rows[0];
      }
    }

    // 3. Resolve input values from request or reservation defaults
    const routeDistanceKm = Number(
      b.routeDistanceKm ?? b.distanceKm ?? b.distance_km ?? reservation?.route_km ?? 0
    );

    let durationMinutes = b.durationMinutes ?? b.duration_min ?? b.duration;
    if (durationMinutes == null && reservation?.trip_start_timestamp && reservation?.trip_end_timestamp) {
      const sTs = new Date(reservation.trip_start_timestamp).getTime();
      const eTs = new Date(reservation.trip_end_timestamp).getTime();
      if (!isNaN(sTs) && !isNaN(eTs) && eTs > sTs) {
        durationMinutes = Math.round((eTs - sTs) / 60000);
      }
    }
    if (durationMinutes == null && routeDistanceKm > 0) {
      durationMinutes = Math.round((routeDistanceKm / 40) * 60);
    }
    durationMinutes = Number(durationMinutes || 0);

    const passengers = Number(b.passengers ?? reservation?.passengers ?? 0);
    const loadKg = Number(b.load_kg ?? b.loadKg ?? b.load ?? reservation?.load_kg ?? 0);
    const trafficBandInput = String(b.trafficBand ?? b.traffic_band ?? 'medium').trim().toLowerCase();
    const trafficBand = ['low', 'medium', 'high'].includes(trafficBandInput) ? trafficBandInput : 'medium';

    const weather = String(b.weather ?? 'normal').trim().toLowerCase();
    const acRaw = b.acUsage ?? b.ac_used ?? b.acUsed ?? false;
    const acUsed = Boolean(acRaw);
    const urbanShare = Number(b.urbanShare ?? b.urban_share ?? 0.5);
    const highwayShare = Number(b.highwayShare ?? b.highway_share ?? 0.5);

    // 4. Construct AI request payload
    const aiPayload = {
      distance_km: Math.max(0, Number(routeDistanceKm) || 0),
      duration_min: Math.max(0, Number(durationMinutes) || 0),
      vehicle_type: String(vehicle.vehicle_type || 'Sedan').trim(),
      make: String(vehicle.make || 'Toyota').trim(),
      model: String(vehicle.model || 'Corolla').trim(),
      vehicle_year: Number(vehicle.vehicle_year || 2020),
      seats: Number(vehicle.seats || 5),
      fuel_type: String(vehicle.fuel_type || 'gasoline').trim(),
      nominal_l_per_100km: Number(vehicle.nominal_l_per_100km || 0),
      allowed_load_kg: Number(vehicle.allowed_load_kg || 0),
      passengers: Math.max(0, Number(passengers) || 0),
      load_kg: Math.max(0, Number(loadKg) || 0),
      traffic_band: trafficBand,
      weather: weather,
      ac_used: acUsed ? 1 : 0,
      urban_share: Number(urbanShare) || 0.5,
      highway_share: Number(highwayShare) || 0.5
    };

    // 5. Call AI API with automatic retry and timeout
    const aiRes = await callAiPredictApi(aiPayload);

    let method = 'baseline';
    let fallbackUsed = true;
    let estimatedLiters = null;
    let modelVersion = null;

    if (aiRes.success && typeof aiRes.predicted_fuel_liters === 'number' && !isNaN(aiRes.predicted_fuel_liters)) {
      estimatedLiters = Number(aiRes.predicted_fuel_liters);
      method = 'ai';
      fallbackUsed = false;
      modelVersion = aiRes.model_version || null;
    } else {
      // Baseline fallback logic if AI API call fails or times out
      const nom = Number(vehicle.nominal_l_per_100km || 0);
      const baseLiters = (routeDistanceKm * nom) / 100;
      const trafficFactor = trafficBand === 'high' ? 1.15 : trafficBand === 'low' ? 0.95 : 1;
      const acFactor = acUsed ? 1.08 : 1;
      estimatedLiters = baseLiters * trafficFactor * acFactor;
      method = 'baseline';
      fallbackUsed = true;
    }

    // 6. Calculate cost, range, confidence, and assumptions
    const nom = Number(vehicle.nominal_l_per_100km || 0);
    const price = Number(process.env.FUEL_PRICE_EGP || 15);
    const estimatedCost = estimatedLiters * price;
    const minLiters = estimatedLiters * 0.88;
    const maxLiters = estimatedLiters * 1.18;
    const confidence = method === 'ai' ? 0.85 : 0.72;

    const assumptions = [];
    if (method === 'ai') {
      assumptions.push('AI fuel prediction');
    }
    assumptions.push(`Nominal consumption: ${nom} L/100km`);
    assumptions.push(`${trafficBand} traffic`);
    assumptions.push(acUsed ? 'AC enabled' : 'AC disabled');
    if (weather && weather !== 'normal') {
      assumptions.push(`Weather: ${weather}`);
    }
    if (fallbackUsed && method === 'baseline') {
      assumptions.push('Baseline fallback used');
    }

    // 7. Store estimate in fuel_estimates table
    await pool.query(
      `INSERT INTO fuel_estimates(
         reservation_id, vehicle_id, route_distance_km, estimated_liters, estimated_cost,
         method, model_version, min_liters, max_liters, confidence, assumptions, fallback_used
       ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       RETURNING *`,
      [
        reservationId,
        vehicleId,
        routeDistanceKm,
        estimatedLiters,
        estimatedCost,
        method,
        modelVersion,
        minLiters,
        maxLiters,
        confidence,
        JSON.stringify(assumptions),
        fallbackUsed
      ]
    );

    // 8. Return response matching existing contract
    return ok(res, {
      method,
      modelVersion,
      estimatedLiters: Number(estimatedLiters.toFixed(2)),
      estimatedCost: Number(estimatedCost.toFixed(2)),
      currency: 'EGP',
      range: {
        minLiters: Number(minLiters.toFixed(2)),
        maxLiters: Number(maxLiters.toFixed(2))
      },
      confidence,
      assumptions,
      fallbackUsed
    });
  } catch (e) {
    console.error('Fuel estimate error:', e);
    return fail(res, 500, 'FUEL_ERROR', 'Unable to estimate fuel.');
  }
});

router.get('/model', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT * FROM fuel_model_registry WHERE status='active' ORDER BY created_at DESC LIMIT 1`
  );
  return ok(
    res,
    r.rows[0] || {
      modelVersion: null,
      status: 'baseline',
      maeLiters: null,
      mape: null,
      baselineMaeLiters: null,
      improvement: 0
    }
  );
});

router.get('/model/metrics', requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT * FROM fuel_model_registry ORDER BY created_at DESC`);
  return ok(res, r.rows);
});

router.get('/estimates', requireAuth, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const c = await pool.query(`SELECT COUNT(*)::int total FROM fuel_estimates`);
  const r = await pool.query(
    `SELECT * FROM fuel_estimates ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  );
  return paged(res, r.rows, c.rows[0].total, page, limit);
});

module.exports = router;


