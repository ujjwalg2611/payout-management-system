require('express-async-errors'); // lets async route handlers `throw` and still hit the error middleware below
const express = require('express');

const usersRoutes = require('./routes/users.routes');
const salesRoutes = require('./routes/sales.routes');
const adminRoutes = require('./routes/admin.routes');
const withdrawalsRoutes = require('./routes/withdrawals.routes');
const webhookRoutes = require('./routes/webhook.routes');
const { AppError } = require('./utils/errors');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/users', usersRoutes);
app.use('/sales', salesRoutes);
app.use('/admin', adminRoutes);
app.use('/', withdrawalsRoutes); // exposes /users/:userId/withdrawals and /withdrawals/:id
app.use('/webhooks', webhookRoutes);

// Centralized error handler - every route/service throws AppError subclasses,
// so this is the single place HTTP status codes get decided.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message });
  }
  console.error(err); // eslint-disable-line no-console
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
});

module.exports = app;
