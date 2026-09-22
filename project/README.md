# University Fleet Backend — Contract Aligned

This version is based on the existing `backend-main` that already worked with the team's PostgreSQL database.

## Important
It does **not** drop or replace the existing core tables:
- `users`
- `vehicles`
- `reservations`
- `trips`

On startup it only creates additive support tables/indexes with `IF NOT EXISTS`.

## Setup

1. Create `.env` from `.env.example`.
2. Make sure PostgreSQL is running and `fleet_db` exists.
3. Install packages:

```cmd
npm install
```

4. Optional: create login credentials for all existing users:

```cmd
npm run seed
```

This creates emails from the existing user names and uses:
- password: `password`

Example generated email:
`ahmed.ali@fleet.demo`

5. Start:

```cmd
npm run dev
```

## URLs

- Health: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/api-docs`
- OpenAPI JSON: `http://localhost:3000/swagger.json`

## Contract coverage

The backend covers the shared API contract:
- Authentication / JWT / RBAC
- Users
- Vehicles / filtering / availability
- Brands / models / specifications
- Drivers / qualifications / availability
- Reservations / cancellation / status history
- Dispatcher approve/reject
- Transaction-safe vehicle conflict protection
- Route estimate mock
- Fuel baseline + model registry
- Trips / assignment / dispatch / start / location / completion
- Fuel transactions / odometer
- Dashboards
- Analytics
- Audit logs
- Notifications
- Maintenance
- CSV/XLSX reports

## Concurrency

Reservation approval uses a PostgreSQL transaction, row locks and a transaction-level advisory lock on the vehicle ID before checking overlapping approved/active reservations. This is the important protection required when two dispatchers approve at the same time.

## Standard response

Success:
```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

Error:
```json
{
  "success": false,
  "error": {
    "code": "VEHICLE_NOT_AVAILABLE",
    "message": "Vehicle is not available for the selected time.",
    "details": null
  }
}
```

## Vercel deployment

This project is Vercel-ready and exports the Express app from `app.js`.

If the GitHub repository contains this project inside a `project` folder, set the Vercel Root Directory to `project`.

Required Vercel environment variables:
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `FUEL_PRICE_EGP`
- `PUBLIC_BASE_URL` (optional; used for the Cloudflare server entry in Swagger)

Do not upload or commit `.env`. Use `.env.example` as the template.

Production endpoints after deployment:
- `GET /health`
- `GET /api-docs`
- `GET /swagger.json`

Swagger lists three server targets:
1. Vercel production
2. Local development
3. Cloudflare public tunnel (when configured)
