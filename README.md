# University Fleet Management System - Backend

Backend service for the University Fleet Management System.

## Tech Stack

* Node.js
* Express.js
* PostgreSQL
* Docker
* Docker Compose
* GitHub Actions

## Project Structure

* `project/` - Backend application
* `project/config/` - Database configuration
* `project/routes/` - API routes
* `project/scripts/` - Database seed scripts
* `project/schema.sql` - Database schema
* `.github/workflows/` - CI workflow

## Environment Variables

Create a `.env` file inside the `project/` directory.

Required variables:

```env
DB_USER=your_database_user
DB_HOST=localhost
DB_DATABASE=your_database_name
DB_PASSWORD=your_database_password
DB_PORT=5432
PORT=3000
```

Do not commit `.env` or any real credentials to GitHub.

The `.env` file is excluded through `.gitignore`.

## Local Setup

From the `project/` directory:

```bash
npm install
npm start
```

## Docker Setup

From the `project/` directory:

```bash
docker compose up -d
```

Check running containers:

```bash
docker compose ps
```

Stop the services:

```bash
docker compose down
```

## Database Schema

Apply the database schema with:

```powershell
Get-Content schema.sql | docker exec -i fleet-db psql -U postgres -d fleet_db
```

## Demo Data

Load the demo data with:

```bash
npm run seed
```

The seed script creates synthetic demo data for:

* Users
* Vehicles
* Reservations
* Trips

No real user or operational data is used.

## API

The backend runs on:

`http://localhost:3000`

Available API groups:

* `/api/users`
* `/api/vehicles`
* `/api/reservations`
* `/api/trips`

## CI

GitHub Actions automatically:

1. Installs dependencies
2. Checks JavaScript syntax
3. Builds the Docker image

Workflow:

`.github/workflows/ci.yml`

## Security Notes

* Never commit `.env` files.
* Never commit passwords, API keys, tokens, or other secrets.
* Use environment variables or secret storage for sensitive configuration.
* Do not log passwords or authentication tokens.
* Demo data is synthetic and intended only for development/testing.

## Current Status

* CI pipeline configured
* Docker environment configured
* PostgreSQL configured
* Database schema configured
* Demo seed data configured
* Environment variables documented
* Local staging environment verified
