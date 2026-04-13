const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { generateQrToken, generatePassword } = require('../utils/hash');
const { generateDraftBill } = require('../engines/transparency.engine');
const { transitionState } = require('../engines/workflow.engine');
const { notifyRole, notifyPatient, createNotification } = require('../utils/notifications');
const { flagEmergencyViolation, checkMedicineOvercharge, checkKickbackPatterns, runAllFraudChecks } = require('../engines/fraud.engine');

const SALT_ROUNDS = 12;
const router = express.Router();

// POST /api/patients/register
router.post('/register', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, age, gender, phone, emergency_contact, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, insurance_provider, insurance_id, is_emergency } = req.body;

    if (!name || !age || !gender || !diagnosis || !diagnosis_code || !ward_type) {
      return res.status(400).json({ error: 'Required fields: name, age, gender, diagnosis, diagnosis_code, ward_type' });
    }

    const db = getDb();
    const rawPassword = generatePassword();
    const passwordHash = await bcrypt.hash(rawPassword, SALT_ROUNDS);
    const email = `patient_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}@sevaarth.com`;
    const qrToken = generateQrToken();

    // Create user account for patient
    const userResult = db.prepare(`INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)`)
      .run(name, email, passwordHash, 'patient', 'Patient');

    // Create patient record
    const patientResult = db.prepare(`
      INSERT INTO patients (user_id, name, age, gender, phone, emergency_contact, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, insurance_provider, insurance_id, is_emergency, qr_token, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userResult.lastInsertRowid, name, age, gender, phone || null, emergency_contact || null,
      diagnosis, diagnosis_code, ward_type, bed_number || null, doctor_id || null,
      insurance_provider || null, insurance_id || null, is_emergency ? 1 : 0,
      qrToken, req.user.id);

    const patientId = patientResult.lastInsertRowid;

    // Log initial state
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?, ?, ?, ?, ?)`)
      .run(patientId, null, 'ADMITTED', req.user.id, 'Patient registered');

    // Handle emergency admission
    if (is_emergency) {
      db.prepare(`INSERT INTO emergency_admissions (patient_id, arrival_time) VALUES (?, datetime('now'))`)
        .run(patientId);
    }

    // Audit
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'patient_registered', 'patient', patientId);

    res.json({
      patient_id: patientId,
      credentials: { email, password: rawPassword },
      qr_token: qrToken,
      qr_url: `/api/patient/qr/${qrToken}`,
      state: 'ADMITTED',
      message: `Patient ${name} registered successfully`
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register patient' });
  }
});

// POST /api/patients/emergency-admit
router.post('/emergency-admit', authenticateToken, requireRole('admin'), async (req, res) => {
  req.body.is_emergency = 1;
  // Reuse register logic
  const registerHandler = router.stack.find(r => r.route?.path === '/register');
  if (registerHandler) {
    return registerHandler.route.stack[0].handle(req, res);
  }
  res.status(500).json({ error: 'Registration handler not found' });
});

// GET /api/admin/bed-grid
router.get('/bed-grid', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const patients = db.prepare(`
      SELECT p.*, u.name as doctor_name,
        (SELECT triggered_at FROM patient_state_log WHERE patient_id = p.id ORDER BY triggered_at DESC LIMIT 1) as last_state_change,
        (SELECT COUNT(*) FROM fraud_flags WHERE patient_id = p.id AND status = 'open') as fraud_count
      FROM patients p
      LEFT JOIN users u ON p.doctor_id = u.id
      WHERE p.state != 'BED_AVAILABLE'
      ORDER BY p.admission_date DESC
    `).all();

    const grid = {
      occupied: patients.filter(p => p.state === 'ADMITTED'),
      ready_soon: patients.filter(p => p.state === 'READY_SOON'),
      ready_for_discharge: patients.filter(p => ['READY', 'DISCHARGING'].includes(p.state)),
      discharged: patients.filter(p => p.state === 'DISCHARGED')
    };

    // Calculate hours in current state
    for (const arr of Object.values(grid)) {
      for (const p of arr) {
        if (p.last_state_change) {
          p.hours_in_state = ((Date.now() - new Date(p.last_state_change).getTime()) / 3600000).toFixed(1);
        }
      }
    }

    res.json(grid);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bed grid' });
  }
});

// DELETE /api/admin/patients/:id
router.delete('/patients/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const patientId = req.params.id;
    
    // Use transaction to ensure complete deletion without foreign key violations
    const deleteTransaction = db.transaction((id) => {
      const patient = db.prepare('SELECT user_id, name FROM patients WHERE id = ?').get(id);
      if (!patient) return null;
      
      const bills = db.prepare('SELECT id FROM bills WHERE patient_id = ?').all(id);
      for (const bill of bills) {
        db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(bill.id);
        db.prepare('DELETE FROM bill_versions WHERE bill_id = ?').run(bill.id);
      }
      db.prepare('DELETE FROM bills WHERE patient_id = ?').run(id);
      
      db.prepare('DELETE FROM patient_state_log WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM discharge_tasks WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM test_orders WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM medicine_dispense_log WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM referrals WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM stay_justifications WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM fraud_flags WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM disputes WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM emergency_admissions WHERE patient_id = ?').run(id);
      db.prepare('DELETE FROM notifications WHERE patient_id = ?').run(id);
      
      db.prepare('DELETE FROM patients WHERE id = ?').run(id);
      
      if (patient.user_id) {
        db.prepare('DELETE FROM users WHERE id = ?').run(patient.user_id);
      }
      return patient;
    });

    const deletedPatient = deleteTransaction(patientId);
    if (!deletedPatient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    // Audit log outside transaction
    db.prepare('INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, 'patient_deleted', 'patient', patientId, deletedPatient.name);

    res.json({ success: true, message: `Patient ${deletedPatient.name} deleted completely.` });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
});

// GET /api/admin/compliance
router.get('/compliance', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const fraudFlags = db.prepare(`
      SELECT ff.*, p.name as patient_name, u.name as flagged_staff_name
      FROM fraud_flags ff
      LEFT JOIN patients p ON ff.patient_id = p.id
      LEFT JOIN users u ON ff.flagged_against = u.id
      ORDER BY CASE ff.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, ff.created_at DESC
    `).all();

    const referralPatterns = db.prepare(`
      SELECT rp.*, u.name as doctor_name
      FROM referral_patterns rp
      JOIN users u ON rp.doctor_id = u.id
      WHERE rp.flagged = 1
      ORDER BY rp.referral_percentage DESC
    `).all();

    const stats = {
      total_flags: fraudFlags.length,
      open_flags: fraudFlags.filter(f => f.status === 'open').length,
      critical_flags: fraudFlags.filter(f => f.severity === 'critical').length,
      by_type: {},
      by_severity: {}
    };

    for (const f of fraudFlags) {
      stats.by_type[f.flag_type] = (stats.by_type[f.flag_type] || 0) + 1;
      stats.by_severity[f.severity] = (stats.by_severity[f.severity] || 0) + 1;
    }

    res.json({ fraud_flags: fraudFlags, referral_patterns: referralPatterns, stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch compliance data' });
  }
});

// POST /api/admin/load-demo
router.post('/load-demo', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();

    // Create patient users
    const patientPasswords = {};
    const createPatientUser = async (name) => {
      const pass = generatePassword();
      const hash = await bcrypt.hash(pass, SALT_ROUNDS);
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}@patient.sevaarth.com`;
      
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return existing.id;
      
      const r = db.prepare(`INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)`)
        .run(name, email, hash, 'patient', 'Patient');
      patientPasswords[name] = { email, password: pass };
      return r.lastInsertRowid;
    };

    // Get doctor IDs
    const drMehta = db.prepare("SELECT id FROM users WHERE email = 'doctor@sevaarth.com'").get();
    const drSharma = db.prepare("SELECT id FROM users WHERE email = 'doctor2@sevaarth.com'").get();
    const nurse = db.prepare("SELECT id FROM users WHERE role = 'nurse' LIMIT 1").get();
    const pharmacy = db.prepare("SELECT id FROM users WHERE role = 'pharmacy' LIMIT 1").get();
    const billing = db.prepare("SELECT id FROM users WHERE role = 'billing' LIMIT 1").get();

    // ── Patient 1: Rohan Verma (ADMITTED) ──
    const rohanUserId = await createPatientUser('Rohan Verma');
    const rohanQr = generateQrToken();
    const rohan = db.prepare(`INSERT OR REPLACE INTO patients (user_id, name, age, gender, phone, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, is_emergency, state, qr_token, created_by, admission_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-2 days'))`)
      .run(rohanUserId, 'Rohan Verma', 28, 'Male', '9876543210', 'Typhoid Fever', 'A01.0', 'general', 'G-101', drMehta?.id, 0, 'ADMITTED', rohanQr, req.user.id);
    const rohanId = rohan.lastInsertRowid;
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(rohanId, null, 'ADMITTED', req.user.id, 'Demo patient');
    
    // Tests for Rohan
    db.prepare(`INSERT INTO test_orders (patient_id, doctor_id, test_name, test_code, is_in_protocol, status, billed_amount, benchmark_amount, created_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', '-1 day'))`).run(rohanId, drMehta?.id, 'CBC', 'CBC-001', 1, 'resulted', 450, 300);
    db.prepare(`INSERT INTO test_orders (patient_id, doctor_id, test_name, test_code, is_in_protocol, status, billed_amount, benchmark_amount, created_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', '-1 day'))`).run(rohanId, drMehta?.id, 'Widal Test', 'WID-001', 1, 'processing', 500, 350);

    // ── Patient 2: Sunita Devi (READY_SOON) ──
    const sunitaUserId = await createPatientUser('Sunita Devi');
    const sunitaQr = generateQrToken();
    const sunita = db.prepare(`INSERT OR REPLACE INTO patients (user_id, name, age, gender, phone, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, insurance_provider, insurance_id, state, qr_token, created_by, admission_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-4 days'))`)
      .run(sunitaUserId, 'Sunita Devi', 35, 'Female', '9876543211', 'Post-Appendectomy Recovery', 'K35.80', 'general', 'G-105', drSharma?.id, 'Star Health', 'SH-2025-001', 'READY_SOON', sunitaQr, req.user.id);
    const sunitaId = sunita.lastInsertRowid;
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(sunitaId, null, 'ADMITTED', req.user.id, 'Demo');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(sunitaId, 'ADMITTED', 'READY_SOON', null, 'AI prediction');

    // Extended stay flag for Sunita
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?,?)`)
      .run(sunitaId, 'extended_stay', 'medium', 'Extended stay: Day 4 of 3 standard days for Appendectomy. No justification filed.', JSON.stringify({ current_day: 4, standard_days: 3 }), drSharma?.id, 0.73, 'stay_analysis');

    // Unbundling flag for Sunita's surgery
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?)`)
      .run(sunitaId, 'unbundling', 'medium', 'Unbundling detected for Appendectomy: Package rate ₹25,000 | Billed separately: ₹38,500 (54% over package)', JSON.stringify({ package: 'Appendectomy', package_price: 25000, unbundled_total: 38500 }), 0.78, 'unbundling_detector');

    // ── Patient 3: Amit Sharma (DISCHARGING) — Most fraud flags ──
    const amitUserId = await createPatientUser('Amit Sharma');
    const amitQr = generateQrToken();
    const amit = db.prepare(`INSERT OR REPLACE INTO patients (user_id, name, age, gender, phone, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, state, qr_token, created_by, admission_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-5 days'))`)
      .run(amitUserId, 'Amit Sharma', 42, 'Male', '9876543212', 'Dengue Fever', 'A90', 'private', 'P-201', drMehta?.id, 'DISCHARGING', amitQr, req.user.id);
    const amitId = amit.lastInsertRowid;
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(amitId, null, 'ADMITTED', req.user.id, 'Demo');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(amitId, 'ADMITTED', 'READY', drMehta?.id, 'Doctor marked ready');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(amitId, 'READY', 'DISCHARGING', drMehta?.id, 'Auto-transition');

    // Discharge tasks for Amit
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status, completed_at, completed_by) VALUES (?,?,?,?,datetime('now', '-1 hour'),?)`).run(amitId, 'Nursing', 'clinical_clearance', 'complete', nurse?.id);
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status) VALUES (?,?,?,?)`).run(amitId, 'Pharmacy', 'medicine_reconciliation', 'pending');
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status) VALUES (?,?,?,?)`).run(amitId, 'Billing', 'final_bill_generation', 'pending');
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status) VALUES (?,?,?,?)`).run(amitId, 'Housekeeping', 'bed_preparation', 'pending');

    // Bill for Amit
    const amitBill = db.prepare(`INSERT INTO bills (patient_id, consultation_fee, room_charges, pharmacy_total, nursing_charges, total_amount, generated_by) VALUES (?,?,?,?,?,?,?)`)
      .run(amitId, 1500, 25000, 12500, 2500, 47000, billing?.id);
    const amitBillId = amitBill.lastInsertRowid;

    // Bill items
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by, variance_flag) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'Consultation Fee', 'Doctor consultation fee', 'SVC-CONSULT', 1, 1500, 1500, 800, drMehta?.id, 1);
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by, variance_flag) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'Room Charges (Private, 5 days)', 'Daily hospital room fee', 'SVC-ROOM', 5, 5000, 25000, 15000, billing?.id, 1);
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by, variance_flag) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'Paracetamol 500mg', 'Paracetamol (fever reducer)', 'MED-1', 20, 340, 6800, 240, pharmacy?.id, 1);
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by) VALUES (?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'CBC', 'Full blood count', 'TEST-CBC', 2, 450, 900, 600, drMehta?.id);
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by) VALUES (?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'NS1 Antigen', 'Dengue early detection test', 'TEST-NS1', 1, 850, 850, 600, drMehta?.id);
    db.prepare(`INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by) VALUES (?,?,?,?,?,?,?,?,?)`).run(amitBillId, 'Nursing Charges', 'Nursing care fee', 'SVC-NURSE', 5, 500, 2500, 1500, nurse?.id);

    // Bill versions for Amit (manipulation)
    db.prepare(`INSERT INTO bill_versions (bill_id, version_number, snapshot, content_hash, total_amount, change_reason, changed_by) VALUES (?,?,?,?,?,?,?)`)
      .run(amitBillId, 1, '[]', 'abc123', 35000, 'Initial bill', billing?.id);
    db.prepare(`INSERT INTO bill_versions (bill_id, version_number, snapshot, content_hash, total_amount, change_reason, changed_by, diff_from_previous) VALUES (?,?,?,?,?,?,?,?)`)
      .run(amitBillId, 2, '[]', 'def456', 47000, 'Added charges', billing?.id, JSON.stringify({ added: [{ item_name: 'Extra charges', total_price: 12000 }] }));

    // Sink test for Amit (LFT ordered 28h ago, no result)
    db.prepare(`INSERT INTO test_orders (patient_id, doctor_id, test_name, test_code, is_in_protocol, status, billed_amount, benchmark_amount, sink_test_flag, created_at) VALUES (?,?,?,?,?,?,?,?,?, datetime('now','-28 hours'))`)
      .run(amitId, drMehta?.id, 'Liver Function Test', 'LFT-001', 1, 'collected', 700, 500, 1);

    // Fraud flags for Amit
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?,?)`)
      .run(amitId, 'overcharge', 'high', 'Medicine overcharge: Paracetamol 500mg charged ₹340/unit vs NPPA ceiling ₹12 (2733% markup)', JSON.stringify({ medicine: 'Paracetamol 500mg', charged: 340, nppa: 12, markup_pct: 2733 }), pharmacy?.id, 0.95, 'nppa_comparison');
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?,?)`)
      .run(amitId, 'sink_test', 'high', 'Sink test suspected: Liver Function Test ordered 28 hours ago with no result uploaded.', JSON.stringify({ test_name: 'Liver Function Test', hours_elapsed: 28 }), drMehta?.id, 0.8, 'rule_engine');
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?,?)`)
      .run(amitId, 'manipulation', 'high', 'Bill manipulation suspected: Total changed by ₹12,000 (34.3%) from version 1 to version 2.', JSON.stringify({ old_total: 35000, new_total: 47000, change_pct: 34.3 }), billing?.id, 0.7, 'version_analysis');

    // Medicine dispense for Amit
    db.prepare(`INSERT INTO medicine_dispense_log (patient_id, medicine_id, quantity, unit_price_charged, nppa_price, variance_amount, dispensed_by, overcharge_flag) VALUES (?,?,?,?,?,?,?,?)`)
      .run(amitId, 1, 20, 340, 12, 6560, pharmacy?.id, 1);

    // ── Patient 4: Meera Patel (DISCHARGED) ──
    const meeraUserId = await createPatientUser('Meera Patel');
    const meeraQr = generateQrToken();
    const meera = db.prepare(`INSERT OR REPLACE INTO patients (user_id, name, age, gender, phone, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, state, discharge_date, qr_token, created_by, admission_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now', '-1 day'),?,?, datetime('now', '-4 days'))`)
      .run(meeraUserId, 'Meera Patel', 29, 'Female', '9876543213', 'Normal Delivery', 'O80', 'private', 'P-301', drSharma?.id, 'DISCHARGED', meeraQr, req.user.id);
    const meeraId = meera.lastInsertRowid;
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(meeraId, null, 'ADMITTED', req.user.id, 'Demo');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(meeraId, 'ADMITTED', 'READY', drSharma?.id, 'Ready');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(meeraId, 'READY', 'DISCHARGING', drSharma?.id, 'Auto');
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(meeraId, 'DISCHARGING', 'DISCHARGED', null, 'Auto-discharge');

    // All tasks complete for Meera
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status, completed_at) VALUES (?,?,?,?,datetime('now', '-1 day'))`).run(meeraId, 'Nursing', 'clinical_clearance', 'complete');
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status, completed_at) VALUES (?,?,?,?,datetime('now', '-1 day'))`).run(meeraId, 'Pharmacy', 'medicine_reconciliation', 'complete');
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status, completed_at) VALUES (?,?,?,?,datetime('now', '-1 day'))`).run(meeraId, 'Billing', 'final_bill_generation', 'complete');
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, status, completed_at) VALUES (?,?,?,?,datetime('now', '-1 day'))`).run(meeraId, 'Housekeeping', 'bed_preparation', 'complete');

    // Paid bill for Meera
    db.prepare(`INSERT INTO bills (patient_id, consultation_fee, room_charges, total_amount, payment_status, paid_at) VALUES (?,?,?,?,?,datetime('now', '-1 day'))`)
      .run(meeraId, 1000, 15000, 32000, 'paid');

    // ── Patient 5: Emergency Patient ──
    const emergUserId = await createPatientUser('Rajesh Kumar');
    const emergQr = generateQrToken();
    const emerg = db.prepare(`INSERT OR REPLACE INTO patients (user_id, name, age, gender, phone, diagnosis, diagnosis_code, ward_type, bed_number, doctor_id, is_emergency, state, qr_token, created_by, admission_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-6 hours'))`)
      .run(emergUserId, 'Rajesh Kumar', 72, 'Male', '9876543214', 'Chest Pain / Acute Coronary Syndrome', 'I21.9', 'icu', 'ICU-01', drMehta?.id, 1, 'ADMITTED', emergQr, req.user.id);
    const emergId = emerg.lastInsertRowid;
    db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?,?,?,?,?)`).run(emergId, null, 'ADMITTED', req.user.id, 'Emergency admission');

    // Emergency admission record
    db.prepare(`INSERT INTO emergency_admissions (patient_id, arrival_time, first_treatment_time, response_minutes, payment_demanded_before_treatment, govt_scheme_eligible, scheme_name) VALUES (?,datetime('now', '-6 hours'),datetime('now', '-5 hours', '-45 minutes'),15,1,1,?)`)
      .run(emergId, 'Ayushman Bharat - Vaya Vandana');

    // Emergency violation flag
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?)`)
      .run(emergId, 'emergency_violation', 'critical', 'CRITICAL: Payment demanded before emergency treatment — violation of Clinical Establishments Act.', JSON.stringify({ patient_id: emergId }), 1.0, 'rule_engine');

    // ── Dr. Mehta kickback pattern ──
    // Create referrals showing kickback
    for (let i = 0; i < 7; i++) {
      db.prepare(`INSERT INTO referrals (patient_id, doctor_id, referred_to_name, referred_to_type, clinical_justification, created_at) VALUES (?,?,?,?,?, datetime('now', '-${i+1} days'))`)
        .run(rohanId, drMehta?.id, 'Apollo Diagnostics', 'lab', 'Routine check', new Date(Date.now() - (i + 1) * 86400000).toISOString());
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(`INSERT INTO referrals (patient_id, doctor_id, referred_to_name, referred_to_type, clinical_justification, created_at) VALUES (?,?,?,?,?, datetime('now', '-${i+10} days'))`)
        .run(rohanId, drMehta?.id, 'SRL Diagnostics', 'lab', 'Specialized test', new Date(Date.now() - (i + 10) * 86400000).toISOString());
    }

    // Kickback fraud flag
    db.prepare(`INSERT INTO fraud_flags (flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?)`)
      .run('kickback', 'medium', 'Suspicious referral pattern: Dr. Arjun Mehta sent 78% of referrals to Apollo Diagnostics in the last 30 days.', JSON.stringify({ doctor: 'Dr. Arjun Mehta', lab: 'Apollo Diagnostics', percentage: 78 }), drMehta?.id, 0.91, 'referral_analysis');

    // Referral pattern
    db.prepare(`INSERT INTO referral_patterns (doctor_id, referred_to_name, referral_count_30d, referral_percentage, anomaly_score, flagged) VALUES (?,?,?,?,?,?)`)
      .run(drMehta?.id, 'Apollo Diagnostics', 7, 78, 0.91, 1);

    // External report violation
    db.prepare(`INSERT INTO referrals (patient_id, doctor_id, referred_to_name, referred_to_type, external_report_submitted, report_rejected, rejection_reason, created_at) VALUES (?,?,?,?,?,?,?,datetime('now', '-3 days'))`)
      .run(rohanId, drMehta?.id, 'Dr. Lal PathLabs', 'lab', 1, 1, null);
    db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?,?,?,?,?,?,?,?)`)
      .run(rohanId, 'external_report_violation', 'low', 'External NABL-accredited lab report rejected without valid clinical reason.', JSON.stringify({ lab: 'Dr. Lal PathLabs' }), drMehta?.id, 0.6, 'rule_engine');

    res.json({
      success: true,
      message: '⚡ Demo hospital loaded with 5 patients, fraud flags, ML scores, and complete data!',
      patients: [
        { name: 'Rohan Verma', state: 'ADMITTED', diagnosis: 'Typhoid Fever' },
        { name: 'Sunita Devi', state: 'READY_SOON', diagnosis: 'Post-Appendectomy' },
        { name: 'Amit Sharma', state: 'DISCHARGING', diagnosis: 'Dengue Fever', fraud_flags: 3 },
        { name: 'Meera Patel', state: 'DISCHARGED', diagnosis: 'Normal Delivery' },
        { name: 'Rajesh Kumar', state: 'ADMITTED', diagnosis: 'Chest Pain (Emergency)', is_emergency: true }
      ],
      credentials: patientPasswords,
      fraud_flags_created: 7
    });
  } catch (error) {
    console.error('Load demo error:', error);
    res.status(500).json({ error: 'Failed to load demo: ' + error.message });
  }
});

// GET /api/admin/staff
router.get('/staff', authenticateToken, requireRole('admin'), (req, res) => {
  const db = getDb();
  const staff = db.prepare(`SELECT id, name, email, role, department, is_active, created_at, last_login FROM users WHERE role != 'patient' ORDER BY role, name`).all();
  res.json(staff);
});

// POST /api/admin/staff
router.post('/staff', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role required' });
    }
    const db = getDb();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.prepare(`INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)`).run(name, email, hash, role, department || null);
    res.json({ id: result.lastInsertRowid, name, email, role, department });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create staff: ' + error.message });
  }
});

// GET /api/admin/notifications
router.get('/notifications', authenticateToken, (req, res) => {
  const { getNotifications, markRead } = require('../utils/notifications');
  const notifs = getNotifications(req.user.id, 100);
  res.json(notifs);
});

// PUT /api/admin/notifications/:id/read
router.put('/notifications/:id/read', authenticateToken, (req, res) => {
  const { markRead } = require('../utils/notifications');
  markRead(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
