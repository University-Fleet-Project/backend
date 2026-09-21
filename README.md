# University Fleet Management System - Backend

Backend service for the University Fleet Management System.

## Tech Stack

* Node.js
* Express.js
* PostgreSQL
* Docker
* Docker Compose
* GitHub Actions
* Vercel

## Project Structure

* `project/` - Backend application
* `project/config/` - Database configuration
* `project/routes/` - API routes
* `project/scripts/` - Database seed scripts
* `project/schema.sql` - Database schema
* `project/api/` - Vercel serverless entry point
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

For deployment, production environment variables must be configured through the deployment platform's environment variable settings.

## Local Setup

From the `project/` directory:

```bash
npm install
npm start
```

The local backend runs on:

```text
http://localhost:3000
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

Available API groups:

* `/api/users`
* `/api/vehicles`
* `/api/reservations`
* `/api/trips`

### Local Base URL

```text
http://localhost:3000
```

### Deployed Base URL

```text
https://university-fleet-backend.vercel.app/
```

The deployed URL is used by the frontend/backend integration team for API integration.

## CI/CD

GitHub Actions automatically runs on pushes to the configured branches and pull requests targeting `main`.

The CI pipeline:

1. Checks out the repository
2. Sets up Node.js 20
3. Installs dependencies with `npm ci`
4. Checks JavaScript syntax
5. Builds the Docker image

Workflow:

```text
.github/workflows/ci.yml
```

### Deployment

The backend is deployed on Vercel.

New changes pushed to the connected GitHub repository can trigger a new Vercel deployment automatically.

Deployment project:

```text
university-fleet-backend
```

## Monitoring and Logs

Deployment and runtime logs can be reviewed through the Vercel project dashboard.

Logs should be used to monitor:

* Deployment failures
* Application runtime errors
* API/server errors
* Database connection issues

Sensitive information such as passwords, API keys, authentication tokens, and other secrets must not be written to logs.

## Security Notes

* Never commit `.env` files.
* Never commit passwords, API keys, tokens, or other secrets.
* Use environment variables or secret storage for sensitive configuration.
* Do not log passwords or authentication tokens.
* Demo data is synthetic and intended only for development/testing.
* Production database credentials must not use local development credentials.

## Current Status

* Git repository and feature branch configured
* GitHub Actions CI pipeline configured
* Docker environment configured
* Docker image build verified
* PostgreSQL local container configured
* PostgreSQL health check configured
* Database schema configured
* Demo seed data configured
* Environment variables documented
* Local staging environment verified
* Backend deployed to Vercel
* Vercel deployment verified
* Automatic deployment workflow configured
* Monitoring and deployment logs available through Vercel

### Pending Integration

* Hosted PostgreSQL connection for the deployed environment
* Final API verification after production database configuration
