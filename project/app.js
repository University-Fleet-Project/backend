require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { bootstrapDatabase } = require('./config/db');
const swagger = require('./swagger');

const auth = require('./routes/auth');
const users = require('./routes/users');
const vehicles = require('./routes/vehicles');
const reservations = require('./routes/reservations');
const dispatcher = require('./routes/dispatcher');
const drivers = require('./routes/drivers');
const routes = require('./routes/routes');
const fuel = require('./routes/fuel');
const trips = require('./routes/trips');
const dashboard = require('./routes/dashboard');
const analytics = require('./routes/analytics');
const audit = require('./routes/audit');
const maintenance = require('./routes/maintenance');
const notifications = require('./routes/notifications');
const reports = require('./routes/reports');
const meta = require('./routes/meta');
const admin = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) =>
  res.json({
    success: true,
    data: { status: 'ok' },
    message: 'Fleet API is running'
  })
);

app.get('/', (_req, res) =>
  res.json({
    success: true,
    data: {
      name: 'University Fleet API',
      version: '2.0.0'
    },
    message: 'Fleet API is running'
  })
);

/*
 * Swagger UI
 *
 * Vercel/serverless deployments can have problems serving the local
 * swagger-ui-express static assets. We load Swagger UI from CDN instead.
 * The OpenAPI document itself is still served by our own /swagger.json route.
 */
app.get('/api-docs', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>University Fleet Management API</title>

  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css"
  />
</head>
<body>
  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>

  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/swagger.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: 'StandaloneLayout'
      });
    };
  </script>
</body>
</html>`);
});

app.get('/swagger.json', (_req, res) => res.json(swagger));

app.use('/api/v1/auth', auth);
app.use('/api/v1/users', users);
app.use('/api/v1/vehicles', vehicles);
app.use('/api/v1/reservations', reservations);
app.use('/api/v1/dispatcher', dispatcher);
app.use('/api/v1/drivers', drivers);
app.use('/api/v1/routes', routes);
app.use('/api/v1/fuel', fuel);
app.use('/api/v1/trips', trips);
app.use('/api/v1/dashboard', dashboard);
app.use('/api/v1/analytics', analytics);
app.use('/api/v1/audit-logs', audit);
app.use('/api/v1/vehicles', maintenance);
app.use('/api/v1/maintenance', maintenance);
app.use('/api/v1/notifications', notifications);
app.use('/api/v1', meta);
app.use('/api/v1/admin', admin);
app.use('/api/v1/reports', reports);

app.use((req, res) =>
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found.',
      details: null
    }
  })
);

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) return next(err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
      details: null
    }
  });
});

const PORT = Number(process.env.PORT || 3000);

if (require.main === module) {
  bootstrapDatabase()
    .then(() =>
      app.listen(PORT, () =>
        console.log(`Fleet API listening on http://localhost:${PORT}`)
      )
    )
    .catch((err) => {
      console.error('Failed to start Fleet API:', err);
      process.exit(1);
    });
}

module.exports = app;
