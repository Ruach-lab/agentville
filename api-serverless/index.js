// Vercel wrapper around the stock Express API (work order, Phase 0).
// The entire Express app becomes one serverless function. vercel.api.json
// sends every request path to this file, and the app's own /api/v1 routing
// takes it from there. No stock code is modified.
const app = require('../src/backend/app');

module.exports = app;
