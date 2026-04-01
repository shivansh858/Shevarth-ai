require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDb } = require('./db/database');
const { authenticateToken } = require('./middleware/auth');
const { checkAutoDischarge, predictReadySoon } = require('./engines/workflow.engine');
const { runAllFraudChecks } = require('./engines/fraud.engine');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize database
initializeDb();

// ═══════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/patient', require('./routes/patient.routes'));
app.use('/api/doctor', authenticateToken, require('./routes/doctor.routes'));
app.use('/api/nurse', require('./routes/nurse.routes'));
app.use('/api/pharmacy', require('./routes/pharmacy.routes'));
app.use('/api/billing', require('./routes/billing.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/patients', require('./routes/admin.routes'));
app.use('/api/fraud', require('./routes/fraud.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ═══════════════════════════════════════════════
// SCHEDULED TASKS
// ═══════════════════════════════════════════════

// Auto-discharge check every 30 seconds
setInterval(() => {
  try { checkAutoDischarge(); } catch (e) { console.error('Auto-discharge error:', e.message); }
}, 30000);

// Fraud engine checks every 60 seconds
setInterval(async () => {
  try { await runAllFraudChecks(); } catch (e) { console.error('Fraud check error:', e.message); }
}, 60000);

// Predict discharge readiness every 5 minutes
setInterval(() => {
  try { predictReadySoon(); } catch (e) { console.error('Predict ready error:', e.message); }
}, 300000);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  VHEAL Patient Protection OS — Backend`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`  ML Service expected at ${process.env.ML_SERVICE_URL || 'http://localhost:8000'}`);
  console.log(`═══════════════════════════════════════════════\n`);
});

module.exports = app;
