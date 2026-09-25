const express = require('express');
const { pool } = require('../config/db');
const { ok, fail, userId } = require('../utils');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function hav(a, b, c, d) {
  const R = 6371;
  const x = ((c - a) * Math.PI) / 180;
  const y = ((d - b) * Math.PI) / 180;
  const h =
    Math.sin(x / 2) ** 2 +
    Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchOsrmRoute(origin, destination) {
  const rawBaseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
  const baseUrl = String(rawBaseUrl).trim().replace(/\/+$/, '');
  const url = `${baseUrl}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=polyline`;

  const timeoutMs = Math.max(1000, Number(process.env.OSRM_TIMEOUT_MS || 5000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[OSRM] HTTP status ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const r = data.routes[0];
      const distanceKm = Number((r.distance / 1000).toFixed(2));
      const durationMinutes = Math.round(r.duration / 60);
      const polyline = r.geometry || null;
      if (distanceKm > 0 && polyline) {
        return {
          distanceKm,
          durationMinutes,
          polyline,
          provider: process.env.OSRM_PROVIDER_NAME || 'osrm'
        };
      }
    } else {
      console.warn('[OSRM] Invalid data response:', data);
    }
  } catch (e) {
    clearTimeout(timer);
    console.warn('[OSRM Fetch Error]:', e.message);
  }
  return null;
}

router.post('/estimate', requireAuth, async (req, res) => {
  const { origin, destination, reservationId } = req.body;
  if (
    origin?.latitude == null ||
    origin?.longitude == null ||
    destination?.latitude == null ||
    destination?.longitude == null
  ) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'Origin and destination coordinates are required.'
    );
  }

  // 1. Try real OSRM routing provider
  const osrmResult = await fetchOsrmRoute(origin, destination);

  let distance, duration, provider, polyline, snapshot;

  if (osrmResult) {
    distance = osrmResult.distanceKm;
    duration = osrmResult.durationMinutes;
    provider = osrmResult.provider;
    polyline = osrmResult.polyline;
    snapshot = { method: 'osrm', rawDistanceMeters: Math.round(distance * 1000) };
  } else {
    // 2. Fallback to Haversine calculation if routing service is unavailable
    distance = Number(
      (hav(origin.latitude, origin.longitude, destination.latitude, destination.longitude) * 1.2).toFixed(2)
    );
    duration = Math.round((distance / 40) * 60);
    provider = 'mock';
    polyline = null;
    snapshot = { method: 'haversine*1.2' };
  }

  try {
    const r = await pool.query(
      `INSERT INTO route_estimates(reservation_id, origin, destination, distance_km, duration_minutes, provider, snapshot)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        reservationId || null,
        JSON.stringify(origin),
        JSON.stringify(destination),
        distance,
        duration,
        provider,
        JSON.stringify(snapshot)
      ]
    );

    return ok(
      res,
      {
        distanceKm: distance,
        durationMinutes: duration,
        provider: provider,
        timestamp: r.rows[0].created_at,
        route: { polyline: polyline }
      },
      'Route estimated'
    );
  } catch (e) {
    console.error('Route estimate error:', e);
    return fail(res, 500, 'ROUTE_ERROR', 'Unable to save route estimate.');
  }
});

module.exports = router;
