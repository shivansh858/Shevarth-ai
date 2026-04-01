const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { runAllFraudChecks, scoreBilling } = require('../engines/fraud.engine');

const router = express.Router();

// GET /api/fraud/flags
router.get('/flags', authenticateToken, requireRole('admin', 'billing'), (req, res) => {
  try {
    const db = getDb();
    const flags = db.prepare(`
      SELECT ff.*, p.name as patient_name, u.name as flagged_staff,
        u.role as flagged_staff_role
      FROM fraud_flags ff
      LEFT JOIN patients p ON ff.patient_id = p.id
      LEFT JOIN users u ON ff.flagged_against = u.id
      ORDER BY CASE ff.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        ff.created_at DESC
    `).all();
    res.json(flags);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fraud flags' });
  }
});

// GET /api/fraud/patterns
router.get('/patterns', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const referralPatterns = db.prepare(`
      SELECT rp.*, u.name as doctor_name
      FROM referral_patterns rp
      JOIN users u ON rp.doctor_id = u.id
      ORDER BY rp.referral_percentage DESC
    `).all();

    // Billing anomaly stats
    const billingStats = db.prepare(`
      SELECT p.name, b.total_amount, ps.max_cost_benchmark,
        CASE WHEN b.total_amount > ps.max_cost_benchmark THEN 1 ELSE 0 END as over_benchmark,
        ROUND((b.total_amount - ps.max_cost_benchmark) * 100.0 / ps.max_cost_benchmark, 1) as variance_pct
      FROM bills b
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN protocol_standards ps ON p.diagnosis_code = ps.diagnosis_code
      WHERE ps.max_cost_benchmark IS NOT NULL
      ORDER BY variance_pct DESC
    `).all();

    // Stay analysis
    const stayAnalysis = db.prepare(`
      SELECT p.name, p.diagnosis, ps.standard_stay_days, ps.max_stay_days,
        CAST(julianday('now') - julianday(p.admission_date) AS INTEGER) as current_day,
        CASE WHEN CAST(julianday('now') - julianday(p.admission_date) AS INTEGER) > ps.standard_stay_days THEN 1 ELSE 0 END as overstay
      FROM patients p
      JOIN protocol_standards ps ON p.diagnosis_code = ps.diagnosis_code
      WHERE p.state IN ('ADMITTED', 'READY_SOON', 'DISCHARGING')
    `).all();

    // Overcharge analysis by department
    const overchargeStats = db.prepare(`
      SELECT u.department, 
        COUNT(*) as total_flags,
        SUM(CASE WHEN ff.severity = 'critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN ff.severity = 'high' THEN 1 ELSE 0 END) as high
      FROM fraud_flags ff
      LEFT JOIN users u ON ff.flagged_against = u.id
      GROUP BY u.department
    `).all();

    // Dispute stats
    const disputeStats = db.prepare(`
      SELECT 
        COUNT(*) as total_disputes,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_disputes,
        SUM(refund_amount) as total_refunds
      FROM disputes
    `).get();

    res.json({
      referral_patterns: referralPatterns,
      billing_anomalies: billingStats,
      stay_analysis: stayAnalysis,
      overcharge_by_department: overchargeStats,
      dispute_stats: disputeStats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

// PUT /api/fraud/resolve/:flagId
router.put('/resolve/:flagId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const { resolution_note } = req.body;
    db.prepare(`UPDATE fraud_flags SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`)
      .run(req.user.id, req.params.flagId);
    
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'fraud_flag_resolved', 'fraud_flag', req.params.flagId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve flag' });
  }
});

// POST /api/fraud/run-analysis
router.post('/run-analysis', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const results = await runAllFraudChecks();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

module.exports = router;
