const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { transitionState } = require('../engines/workflow.engine');
const { scoreJustification, checkExtendedStay, checkKickbackPatterns } = require('../engines/fraud.engine');
const { addBillItem } = require('../engines/transparency.engine');
const { notifyPatient } = require('../utils/notifications');

const router = express.Router();

// GET /api/doctor/patients — assigned patients
router.get('/patients', authenticateToken, requireRole('doctor'), (req, res) => {
  try {
    const db = getDb();
    const patients = db.prepare(`
      SELECT p.*, ps.standard_stay_days, ps.max_stay_days, ps.diagnosis_name as protocol_diagnosis,
        (SELECT COUNT(*) FROM test_orders WHERE patient_id = p.id) as test_count,
        (SELECT COUNT(*) FROM fraud_flags WHERE patient_id = p.id AND status = 'open') as fraud_flag_count
      FROM patients p
      LEFT JOIN protocol_standards ps ON p.diagnosis_code = ps.diagnosis_code
      WHERE p.doctor_id = ? AND p.state != 'BED_AVAILABLE'
      ORDER BY CASE p.state
        WHEN 'DISCHARGING' THEN 1 WHEN 'READY' THEN 2 WHEN 'READY_SOON' THEN 3
        WHEN 'ADMITTED' THEN 4 WHEN 'DISCHARGED' THEN 5 ELSE 6 END
    `).all(req.user.id);

    // Calculate current day for each patient
    const patientsWithDays = patients.map(p => {
      const admissionDate = new Date(p.admission_date);
      const currentDay = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));
      return { ...p, current_day: currentDay, overstay: currentDay > (p.standard_stay_days || 999) };
    });

    res.json(patientsWithDays);
  } catch (error) {
    console.error('Doctor patients error:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// POST /api/doctor/order-test
router.post('/order-test', authenticateToken, requireRole('doctor'), async (req, res) => {
  try {
    const { patient_id, test_name, test_code, justification } = req.body;
    if (!patient_id || !test_name) {
      return res.status(400).json({ error: 'Patient ID and test name required' });
    }

    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND doctor_id = ?').get(patient_id, req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found or not assigned to you' });

    // Check protocol compliance
    const protocol = db.prepare('SELECT * FROM protocol_standards WHERE diagnosis_code = ?').get(patient.diagnosis_code);
    let isInProtocol = 1;
    let nlpScore = null;
    let nlpAnalysis = null;

    if (protocol) {
      const required = JSON.parse(protocol.required_tests);
      const optional = JSON.parse(protocol.optional_tests);
      isInProtocol = [...required, ...optional].some(t => t.toLowerCase() === test_name.toLowerCase()) ? 1 : 0;
    }

    // If outside protocol, require justification and score it
    if (!isInProtocol) {
      if (!justification) {
        return res.status(400).json({ error: 'Justification required for out-of-protocol test', is_in_protocol: false });
      }
      // Score justification via ML
      const mlResult = await scoreJustification(justification, patient.diagnosis_code, test_name, true);
      nlpScore = mlResult.validity_score;
      nlpAnalysis = mlResult.analysis_text;
    }

    // Determine benchmark amount
    const benchmarkAmounts = {
      'CBC': 300, 'LFT': 500, 'RFT': 450, 'Blood Culture': 800, 'Widal Test': 350,
      'ECG': 400, 'Chest X-Ray': 500, 'CT Brain': 3500, 'CT Chest': 4000,
      'MRI Brain': 7000, 'Ultrasound Abdomen': 1200, 'Troponin I': 700,
      'Lipid Profile': 450, 'HbA1c': 400, 'Blood Group': 200, 'Coagulation Profile': 600,
      'Urinalysis': 200, 'Urine Culture': 400, 'Stool Culture': 400,
      'NS1 Antigen': 600, 'Dengue IgM/IgG': 800, 'CRP': 500, 'D-Dimer': 800,
      'RT-PCR': 500, 'Procalcitonin': 1200, 'ABG': 800
    };
    const benchmark = benchmarkAmounts[test_name] || 500;
    const billedAmount = benchmark * (1.2 + Math.random() * 0.8); // Hospital markup

    const result = db.prepare(`
      INSERT INTO test_orders (patient_id, doctor_id, test_name, test_code, is_in_protocol, justification, billed_amount, benchmark_amount, nlp_justification_score, nlp_justification_analysis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, req.user.id, test_name, test_code || null, isInProtocol, justification || null,
      Math.round(billedAmount), benchmark, nlpScore, nlpAnalysis);

    // Add to bill if exists
    const bill = db.prepare('SELECT id FROM bills WHERE patient_id = ?').get(patient_id);
    if (bill) {
      addBillItem(bill.id, { item_name: test_name, unit_price: Math.round(billedAmount), benchmark_price: benchmark, item_code: `TEST-${test_code || result.lastInsertRowid}` }, req.user.id);
    }

    // Notify patient
    notifyPatient(patient_id, 'test_ordered', `🧪 Test Ordered: ${test_name}`,
      `Dr. ${req.user.name} has ordered ${test_name}.${!isInProtocol ? ' ⚠️ This test is outside the standard protocol.' : ''}`);

    res.json({
      id: result.lastInsertRowid,
      test_name,
      is_in_protocol: isInProtocol === 1,
      justification_score: nlpScore,
      justification_analysis: nlpAnalysis,
      billed_amount: Math.round(billedAmount),
      benchmark_amount: benchmark
    });
  } catch (error) {
    console.error('Order test error:', error);
    res.status(500).json({ error: 'Failed to order test' });
  }
});

// PUT /api/doctor/test-result/:testId
router.put('/test-result/:testId', authenticateToken, requireRole('doctor'), (req, res) => {
  try {
    const db = getDb();
    const { result_summary } = req.body;
    
    db.prepare(`UPDATE test_orders SET status = 'resulted', result_uploaded_at = datetime('now'), result_file_path = ? WHERE id = ? AND doctor_id = ?`)
      .run(result_summary || 'Result uploaded', req.params.testId, req.user.id);

    const test = db.prepare('SELECT * FROM test_orders WHERE id = ?').get(req.params.testId);
    if (test) {
      notifyPatient(test.patient_id, 'test_result', `✅ Test Result: ${test.test_name}`, 'Your test result has been uploaded.');
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload test result' });
  }
});

// PUT /api/doctor/mark-ready/:patientId
router.put('/mark-ready/:patientId', authenticateToken, requireRole('doctor'), (req, res) => {
  try {
    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND doctor_id = ?').get(req.params.patientId, req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Transition through READY → DISCHARGING
    transitionState(patient.id, 'READY', req.user.id, 'Doctor marked ready for discharge');
    const result = transitionState(patient.id, 'DISCHARGING', req.user.id, 'Auto-transition to DISCHARGING');

    res.json({ success: true, ...result, message: 'Patient marked ready for discharge. Discharge tasks created.' });
  } catch (error) {
    console.error('Mark ready error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/doctor/stay-justification
router.post('/stay-justification', authenticateToken, requireRole('doctor'), async (req, res) => {
  try {
    const { patient_id, clinical_reason, criteria_not_met, expected_discharge } = req.body;
    if (!patient_id || !clinical_reason) {
      return res.status(400).json({ error: 'Patient ID and clinical reason required' });
    }

    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND doctor_id = ?').get(patient_id, req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const admissionDate = new Date(patient.admission_date);
    const dayNumber = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));

    // Score justification
    const mlResult = await scoreJustification(clinical_reason, patient.diagnosis_code, 'Extended Stay', true);
    const weakFlag = mlResult.validity_score < 0.5 ? 1 : 0;

    const result = db.prepare(`
      INSERT INTO stay_justifications (patient_id, doctor_id, day_number, clinical_reason, criteria_not_met, expected_discharge, is_insurance_case, weak_justification_flag, nlp_validity_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patient_id, req.user.id, dayNumber, clinical_reason,
      JSON.stringify(criteria_not_met || []), expected_discharge || null,
      patient.insurance_provider ? 1 : 0, weakFlag, mlResult.validity_score);

    res.json({
      id: result.lastInsertRowid,
      day_number: dayNumber,
      justification_score: mlResult.validity_score,
      weak_flag: weakFlag === 1,
      analysis: mlResult.analysis_text
    });
  } catch (error) {
    console.error('Stay justification error:', error);
    res.status(500).json({ error: 'Failed to file stay justification' });
  }
});

// POST /api/doctor/referral
router.post('/referral', authenticateToken, requireRole('doctor'), async (req, res) => {
  try {
    const { patient_id, referred_to_name, referred_to_type, clinical_justification, is_mandatory } = req.body;
    
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO referrals (patient_id, doctor_id, referred_to_name, referred_to_type, clinical_justification, is_mandatory, alternatives_shown)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(patient_id, req.user.id, referred_to_name, referred_to_type, clinical_justification || null, is_mandatory ? 1 : 0);

    // Get NABL alternatives
    const alternatives = db.prepare('SELECT name, nabl_number, location FROM nabl_labs LIMIT 5').all();

    // Check kickback patterns
    await checkKickbackPatterns(req.user.id);

    // Notify patient with alternatives
    notifyPatient(patient_id, 'referral', `📋 Referral: ${referred_to_name}`,
      `You have been referred to ${referred_to_name} for ${referred_to_type}. Note: You are NOT required to use this specific ${referred_to_type}. You can choose any NABL-accredited lab.`);

    res.json({ id: result.lastInsertRowid, alternatives, message: 'Referral created. Patient notified with alternatives.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create referral' });
  }
});

module.exports = router;
