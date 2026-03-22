const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/donors', require('./routes/donors'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/certificate', require('./routes/certificate'));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    message: 'BloodLife API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to BloodLife API',
    version: '1.0.0',
    description: 'Blood Donation Management System',
    endpoints: {
      auth: {
        signup: 'POST /api/auth/signup',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        updateProfile: 'PUT /api/auth/update-profile',
        changePassword: 'PUT /api/auth/change-password',
        deleteAccount: 'DELETE /api/auth/delete-account'
      },
      donors: {
        getAll: 'GET /api/donors',
        search: 'GET /api/donors/search',
        getProfile: 'GET /api/donors/profile',
        getById: 'GET /api/donors/:id',
        create: 'POST /api/donors',
        updateProfile: 'PUT /api/donors/profile',
        updateById: 'PUT /api/donors/:id',
        deleteProfile: 'DELETE /api/donors/profile'
      },
      requests: {
        getAll: 'GET /api/requests',
        myRequests: 'GET /api/requests/my-requests',
        createDonorRequest: 'POST /api/requests/create',
        donorRequests: 'GET /api/requests/donor',
        receiverRequests: 'GET /api/requests/receiver',
        nearby: 'GET /api/requests/nearby',
        getById: 'GET /api/requests/:id',
        create: 'POST /api/requests',
        update: 'PUT /api/requests/:id',
        cancel: 'PUT /api/requests/:id/cancel',
        accept: 'PUT /api/requests/:id/accept',
        complete: 'PUT /api/requests/:id/complete',
        fulfill: 'PUT /api/requests/:id/fulfill',
        respond: 'POST /api/requests/:id/respond',
        delete: 'DELETE /api/requests/:id'
      },
      certificate: {
        download: 'GET /api/certificate/:requestId'
      },
      health: 'GET /api/health'
    }
  });
});

// 404 handler - must come after all routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    availableEndpoints: '/api/health for API status'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Something went wrong!',
    error: process.env.NODE_ENV === 'development'
      ? {
          message: err.message,
          stack: err.stack
        }
      : undefined
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('BloodLife API Server Started');
    console.log('='.repeat(50));
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`API Health: http://localhost:${PORT}/api/health`);
    console.log(`API Docs: http://localhost:${PORT}/`);
    console.log('='.repeat(50));
  });

  process.on('unhandledRejection', (err) => {
    console.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
}

module.exports = app;
