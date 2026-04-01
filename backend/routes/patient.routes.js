const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { getPatientRights, checkGovtSchemeEligibility, getDisputeOptions } = require('../engines/rights.engine');
const { getBillWithDetails } = require('../engines/transparency.engine');
const { getNotifications } = require('../utils/notifications');

const router = express.Router();

// GET /api/patient/portal — Complete patient journey
router.get('/portal', authenticateToken, requireRole('patient'), (req, res) => {
  try {
    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient record not found' });

    // State history
    const stateHistory = db.prepare('SELECT * FROM patient_state_log WHERE patient_id = ? ORDER BY triggered_at ASC').all(patient.id);

    // Discharge tasks
    const dischargeTasks = db.prepare(`
      SELECT dt.*, u.name as assigned_to_name
      FROM discharge_tasks dt
      LEFT JOIN users u ON dt.assigned_to = u.id
      WHERE dt.patient_id = ?
      ORDER BY dt.created_at ASC
    `).all(patient.id);

    // Test orders
    const testOrders = db.prepare(`
      SELECT t.*, u.name as doctor_name
      FROM test_orders t
      JOIN users u ON t.doctor_id = u.id
      WHERE t.patient_id = ?
      ORDER BY t.created_at DESC
    `).all(patient.id);

    // Protocol info for test compliance
    const protocol = db.prepare('SELECT * FROM protocol_standards WHERE diagnosis_code = ?').get(patient.diagnosis_code);

    // Medicines
    const medicines = db.prepare(`
      SELECT mdl.*, mc.name, mc.generic_name, mc.nppa_ceiling_price, mc.brand_name, mc.is_private_label,
        mc2.name as generic_alternative_name, mc2.nppa_ceiling_price as generic_price
      FROM medicine_dispense_log mdl
      JOIN medicine_catalog mc ON mdl.medicine_id = mc.id
      LEFT JOIN medicine_catalog mc2 ON mc.generic_equivalent_id = mc2.id
      WHERE mdl.patient_id = ?
      ORDER BY mdl.dispensed_at DESC
    `).all(patient.id);

    // Bill with items and versions
    const bill = getBillWithDetails(patient.id);

    // Fraud flags
    const fraudFlags = db.prepare('SELECT * FROM fraud_flags WHERE patient_id = ? ORDER BY created_at DESC').all(patient.id);

    // Disputes
    const disputes = db.prepare(`
      SELECT d.*, bi.item_name, bi.plain_language_name
      FROM disputes d
      LEFT JOIN bill_items bi ON d.bill_item_id = bi.id
      WHERE d.patient_id = ?
      ORDER BY d.raised_at DESC
    `).all(patient.id);

    // Rights panel
    const rights = getPatientRights(patient.id);
    const govtSchemes = checkGovtSchemeEligibility(patient.id);

    // Notifications
    const notifications = getNotifications(req.user.id, 100);

    // Doctor info
    const doctor = db.prepare('SELECT name, department FROM users WHERE id = ?').get(patient.doctor_id);

    // Admission day count
    const admissionDate = new Date(patient.admission_date);
    const currentDay = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      patient: {
        ...patient,
        doctor_name: doctor?.name,
        doctor_department: doctor?.department,
        current_day: currentDay,
        standard_stay_days: protocol?.standard_stay_days,
        max_stay_days: protocol?.max_stay_days
      },
      state_history: stateHistory,
      discharge_tasks: dischargeTasks,
      test_orders: testOrders,
      protocol,
      medicines,
      bill,
      fraud_flags: fraudFlags,
      disputes,
      rights,
      govt_schemes: govtSchemes,
      dispute_options: getDisputeOptions(),
      notifications
    });
  } catch (error) {
    console.error('Patient portal error:', error);
    res.status(500).json({ error: 'Failed to load patient portal' });
  }
});

// POST /api/patient/dispute
router.post('/dispute', authenticateToken, requireRole('patient'), (req, res) => {
  try {
    const { bill_item_id, dispute_type, description } = req.body;
    if (!dispute_type || !description) {
      return res.status(400).json({ error: 'Dispute type and description required' });
    }

    const db = getDb();
    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const result = db.prepare(`
      INSERT INTO disputes (patient_id, bill_item_id, dispute_type, description) VALUES (?, ?, ?, ?)
    `).run(patient.id, bill_item_id || null, dispute_type, description);

    // Notify billing department
    const { notifyRole } = require('../utils/notifications');
    notifyRole('billing', patient.id, 'dispute', '🔔 New Dispute Filed',
      `Patient dispute: ${dispute_type} — ${description}`);

    // Audit
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'dispute_filed', 'dispute', result.lastInsertRowid);

    res.json({ id: result.lastInsertRowid, status: 'open', message: 'Dispute filed successfully' });
  } catch (error) {
    console.error('Dispute error:', error);
    res.status(500).json({ error: 'Failed to file dispute' });
  }
});

// POST /api/patient/submit-external-report
router.post('/submit-external-report', authenticateToken, requireRole('patient'), (req, res) => {
  try {
    const { referral_id, lab_name, nabl_number, report_data } = req.body;
    const db = getDb();
    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Verify NABL lab
    const lab = db.prepare('SELECT * FROM nabl_labs WHERE nabl_number = ?').get(nabl_number);
    const isValidNabl = !!lab;

    db.prepare(`UPDATE referrals SET external_report_submitted = 1 WHERE id = ? AND patient_id = ?`)
      .run(referral_id, patient.id);

    res.json({ success: true, nabl_verified: isValidNabl, lab_name: lab?.name || lab_name });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit external report' });
  }
});

// GET /api/patient/qr/:qr_token — Public access portal via QR code
router.get('/qr/:qr_token', (req, res) => {
  try {
    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE qr_token = ?').get(req.params.qr_token);
    if (!patient) return res.status(404).json({ error: 'Invalid QR code' });

    // Return limited portal view
    const stateHistory = db.prepare('SELECT * FROM patient_state_log WHERE patient_id = ? ORDER BY triggered_at ASC').all(patient.id);
    const dischargeTasks = db.prepare('SELECT department, task_type, status, completed_at FROM discharge_tasks WHERE patient_id = ?').all(patient.id);
    const bill = getBillWithDetails(patient.id);
    const rights = getPatientRights(patient.id);
    const fraudFlags = db.prepare('SELECT flag_type, severity, description, created_at FROM fraud_flags WHERE patient_id = ? AND status = ?').all(patient.id, 'open');

    res.json({
      patient: { name: patient.name, diagnosis: patient.diagnosis, state: patient.state, admission_date: patient.admission_date, ward_type: patient.ward_type },
      state_history: stateHistory,
      discharge_tasks: dischargeTasks,
      bill,
      fraud_flags: fraudFlags,
      rights
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load QR portal' });
  }
});

module.exports = router;
