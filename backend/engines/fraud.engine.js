const { getDb } = require('../db/database');
const { notifyPatient, notifyRole } = require('../utils/notifications');
const axios = require('axios');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// ═══════════════════════════════════════════════════
// FRAUD TYPE 1: SINK TESTS
// ═══════════════════════════════════════════════════
function checkSinkTests() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const suspiciousTests = db.prepare(`
    SELECT t.*, p.name as patient_name, u.name as doctor_name
    FROM test_orders t
    JOIN patients p ON t.patient_id = p.id
    JOIN users u ON t.doctor_id = u.id
    WHERE t.status = 'collected' AND t.created_at < ? AND t.sink_test_flag = 0
  `).all(cutoff);

  for (const test of suspiciousTests) {
    db.prepare('UPDATE test_orders SET sink_test_flag = 1 WHERE id = ?').run(test.id);
    
    const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'sink_test' AND description LIKE ?`).get(test.patient_id, `%${test.test_name}%`);
    if (!existing) {
      db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        test.patient_id, 'sink_test', 'high',
        `Sink test suspected: ${test.test_name} ordered ${Math.round((Date.now() - new Date(test.created_at).getTime()) / 3600000)}h ago with no result uploaded.`,
        JSON.stringify({ test_id: test.id, test_name: test.test_name, hours_elapsed: Math.round((Date.now() - new Date(test.created_at).getTime()) / 3600000) }),
        test.doctor_id, 0.8, 'rule_engine'
      );
      notifyPatient(test.patient_id, 'fraud_alert', '⚠️ Test Result Delayed',
        `Your ${test.test_name} result has not been uploaded after 24 hours. This may indicate a sink test — a test ordered but never processed.`);
    }
  }
  return suspiciousTests.length;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 2: MEDICINE OVERCHARGE
// ═══════════════════════════════════════════════════
function checkMedicineOvercharge(dispenseId) {
  const db = getDb();
  const dispense = db.prepare(`
    SELECT mdl.*, mc.name, mc.nppa_ceiling_price, mc.generic_name, mc.generic_equivalent_id
    FROM medicine_dispense_log mdl
    JOIN medicine_catalog mc ON mdl.medicine_id = mc.id
    WHERE mdl.id = ?
  `).get(dispenseId);

  if (!dispense || !dispense.nppa_ceiling_price) return null;

  if (dispense.unit_price_charged > dispense.nppa_ceiling_price * 1.10) {
    const markupPct = Math.round(((dispense.unit_price_charged - dispense.nppa_ceiling_price) / dispense.nppa_ceiling_price) * 100);
    
    db.prepare('UPDATE medicine_dispense_log SET overcharge_flag = 1 WHERE id = ?').run(dispenseId);

    const flagId = db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      dispense.patient_id, 'overcharge',
      markupPct > 500 ? 'high' : 'medium',
      `Medicine overcharge: ${dispense.name} charged ₹${dispense.unit_price_charged} vs NPPA ceiling ₹${dispense.nppa_ceiling_price} (${markupPct}% markup)`,
      JSON.stringify({ medicine: dispense.name, charged: dispense.unit_price_charged, nppa: dispense.nppa_ceiling_price, markup_pct: markupPct }),
      dispense.dispensed_by, 0.95, 'nppa_comparison'
    ).lastInsertRowid;

    let genericMsg = '';
    if (dispense.generic_equivalent_id) {
      const generic = db.prepare('SELECT * FROM medicine_catalog WHERE id = ?').get(dispense.generic_equivalent_id);
      if (generic) genericMsg = ` A generic alternative (${generic.generic_name}) is available at ₹${generic.nppa_ceiling_price}.`;
    }

    notifyPatient(dispense.patient_id, 'fraud_alert', '💊 Medicine Overcharge Detected',
      `${dispense.name} is being charged at ₹${dispense.unit_price_charged} — the government ceiling (NPPA) price is ₹${dispense.nppa_ceiling_price} (${markupPct}% markup).${genericMsg}`);

    return { flagId, markup: markupPct };
  }
  return null;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 3: KICKBACK PATTERNS
// ═══════════════════════════════════════════════════
async function checkKickbackPatterns(doctorId) {
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const referrals = db.prepare(`
    SELECT referred_to_name, COUNT(*) as count
    FROM referrals
    WHERE doctor_id = ? AND created_at > ?
    GROUP BY referred_to_name
    ORDER BY count DESC
  `).all(doctorId, thirtyDaysAgo);

  const totalReferrals = referrals.reduce((sum, r) => sum + r.count, 0);
  if (totalReferrals === 0) return null;

  const results = [];
  for (const ref of referrals) {
    const percentage = (ref.count / totalReferrals) * 100;
    
    // Update referral patterns
    db.prepare(`INSERT OR REPLACE INTO referral_patterns (doctor_id, referred_to_name, referral_count_30d, referral_percentage, computed_at${percentage > 60 ? ', flagged' : ''}) VALUES (?, ?, ?, ?, ?${percentage > 60 ? ', 1' : ''})`).run(
      doctorId, ref.referred_to_name, ref.count, percentage, new Date().toISOString()
    );

    if (percentage > 60) {
      const doctor = db.prepare('SELECT name FROM users WHERE id = ?').get(doctorId);
      const existing = db.prepare(`SELECT id FROM fraud_flags WHERE flagged_against = ? AND flag_type = 'kickback' AND status = 'open'`).get(doctorId);
      
      if (!existing) {
        db.prepare(`INSERT INTO fraud_flags (flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          'kickback', 'medium',
          `Suspicious referral pattern: ${doctor?.name || 'Doctor'} sent ${percentage.toFixed(0)}% of referrals to ${ref.referred_to_name} in the last 30 days.`,
          JSON.stringify({ doctor_id: doctorId, lab: ref.referred_to_name, percentage: percentage.toFixed(1), count: ref.count, total: totalReferrals }),
          doctorId, 0.7, 'referral_analysis'
        );
      }
      results.push({ lab: ref.referred_to_name, percentage, count: ref.count, flagged: true });
    }
  }

  // Try ML scoring
  try {
    const response = await axios.post(`${ML_URL}/ml/score-referral`, {
      doctor_id: doctorId,
      referred_to: referrals[0]?.referred_to_name,
      time_period_days: 30
    }, { timeout: 5000 });
    
    if (response.data && response.data.is_suspicious) {
      db.prepare(`UPDATE referral_patterns SET cluster_id = ?, anomaly_score = ? WHERE doctor_id = ? AND referred_to_name = ?`)
        .run(response.data.cluster_id, response.data.confidence, doctorId, referrals[0].referred_to_name);
    }
  } catch (e) { /* ML service may not be running */ }

  return results;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 4: EXTENDED STAY
// ═══════════════════════════════════════════════════
function checkExtendedStay(patientId) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) return null;

  const protocol = db.prepare('SELECT * FROM protocol_standards WHERE diagnosis_code = ?').get(patient.diagnosis_code);
  if (!protocol) return null;

  const admissionDate = new Date(patient.admission_date);
  const currentDay = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));

  if (currentDay > protocol.standard_stay_days) {
    const justification = db.prepare(`SELECT * FROM stay_justifications WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`).get(patientId);
    const isJustified = justification && !justification.weak_justification_flag;

    if (!isJustified) {
      const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'extended_stay' AND status = 'open'`).get(patientId);
      if (!existing) {
        const severity = currentDay > protocol.max_stay_days ? 'high' : 'medium';
        db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          patientId, 'extended_stay', severity,
          `Extended stay: Day ${currentDay} of ${protocol.standard_stay_days} standard days for ${protocol.diagnosis_name}.${justification ? ' Justification filed but flagged as weak.' : ' No justification filed.'}`,
          JSON.stringify({ current_day: currentDay, standard_days: protocol.standard_stay_days, max_days: protocol.max_stay_days, has_justification: !!justification }),
          patient.doctor_id, currentDay > protocol.max_stay_days ? 0.85 : 0.65, 'stay_analysis'
        );
        notifyPatient(patientId, 'rights_info', '📋 Stay Duration Notice',
          `Your stay has exceeded the standard ${protocol.standard_stay_days} days for ${protocol.diagnosis_name}. You have the legal right to request voluntary discharge.`);
      }
    }

    return { currentDay, standardDays: protocol.standard_stay_days, maxDays: protocol.max_stay_days, isJustified };
  }
  return null;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 5: UNBUNDLING
// ═══════════════════════════════════════════════════
function checkUnbundling(billId) {
  const db = getDb();
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(billId);
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) return [];

  const packages = db.prepare('SELECT * FROM procedure_packages').all();
  const results = [];

  for (const pkg of packages) {
    const components = JSON.parse(pkg.included_components);
    const matchedItems = items.filter(item => 
      components.some(comp => item.item_name.toLowerCase().includes(comp.toLowerCase()))
    );

    if (matchedItems.length >= 2) {
      const unbundledTotal = matchedItems.reduce((sum, i) => sum + i.total_price, 0);
      const packagePrice = pkg.package_price_cghs;
      
      if (unbundledTotal > packagePrice * 1.15) {
        const variancePct = ((unbundledTotal - packagePrice) / packagePrice * 100).toFixed(1);
        
        const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'unbundling' AND description LIKE ?`).get(bill.patient_id, `%${pkg.procedure_name}%`);
        if (!existing) {
          db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            bill.patient_id, 'unbundling', 'medium',
            `Unbundling detected for ${pkg.procedure_name}: Package rate ₹${packagePrice} | Billed as separate items: ₹${unbundledTotal} (${variancePct}% over package)`,
            JSON.stringify({ package: pkg.procedure_name, package_price: packagePrice, unbundled_total: unbundledTotal, variance_pct: variancePct, matched_items: matchedItems.map(i => i.item_name) }),
            0.75, 'unbundling_detector'
          );
          notifyPatient(bill.patient_id, 'fraud_alert', '📦 Unbundling Detected',
            `Your ${pkg.procedure_name} is being billed as separate items (₹${unbundledTotal}) instead of the package rate (₹${packagePrice}).`);
        }
        results.push({ package: pkg.procedure_name, packagePrice, unbundledTotal, variancePct });
      }
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 6: BILL MANIPULATION
// ═══════════════════════════════════════════════════
function checkBillManipulation(billId) {
  const db = getDb();
  const versions = db.prepare('SELECT * FROM bill_versions WHERE bill_id = ? ORDER BY version_number ASC').all(billId);
  if (versions.length < 2) return null;

  const latest = versions[versions.length - 1];
  const previous = versions[versions.length - 2];
  const amountChange = latest.total_amount - previous.total_amount;
  const changePct = Math.abs(amountChange / previous.total_amount * 100);

  if (changePct > 10 && Math.abs(amountChange) > 1000) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'manipulation' AND status = 'open'`).get(bill.patient_id);
    
    if (!existing) {
      db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        bill.patient_id, 'manipulation',
        changePct > 25 ? 'high' : 'medium',
        `Bill manipulation suspected: Total changed by ₹${Math.abs(amountChange).toFixed(0)} (${changePct.toFixed(1)}%) from version ${previous.version_number} to ${latest.version_number}.`,
        JSON.stringify({ bill_id: billId, old_total: previous.total_amount, new_total: latest.total_amount, change: amountChange, change_pct: changePct, diff: latest.diff_from_previous }),
        latest.changed_by, 0.7, 'version_analysis'
      );
      notifyPatient(bill.patient_id, 'fraud_alert', '📝 Bill Change Detected',
        `Your bill total was changed by ₹${Math.abs(amountChange).toFixed(0)} (${changePct.toFixed(1)}%). Review your bill history for details.`);
    }
    return { amountChange, changePct, versions: versions.length };
  }
  return null;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 7: EMERGENCY CARE DENIAL
// ═══════════════════════════════════════════════════
function flagEmergencyViolation(patientId, demandBy) {
  const db = getDb();
  
  db.prepare(`UPDATE emergency_admissions SET payment_demanded_before_treatment = 1, payment_demand_by = ? WHERE patient_id = ?`).run(demandBy, patientId);

  db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    patientId, 'emergency_violation', 'critical',
    'CRITICAL: Payment demanded before emergency treatment — violation of Clinical Establishments Act.',
    JSON.stringify({ patient_id: patientId, demand_by: demandBy, timestamp: new Date().toISOString() }),
    demandBy, 1.0, 'rule_engine'
  );

  notifyRole('admin', patientId, 'critical_alert', '🚨 EMERGENCY VIOLATION',
    'Payment was demanded before emergency treatment. This is a legal violation.');
  notifyPatient(patientId, 'rights_info', '🏥 Your Emergency Rights',
    'Under the Clinical Establishments Act, you cannot be denied emergency treatment for non-payment. This violation has been logged.');
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 8: WRONGFUL DETENTION
// ═══════════════════════════════════════════════════
function checkWrongfulDetention() {
  const db = getDb();
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  
  const detained = db.prepare(`
    SELECT p.*, psl.triggered_at as cleared_at
    FROM patients p
    JOIN patient_state_log psl ON p.id = psl.patient_id
    WHERE p.state = 'DISCHARGED'
    AND psl.to_state = 'DISCHARGED'
    AND psl.triggered_at < ?
    AND p.discharge_date IS NULL
  `).all(sixHoursAgo);

  for (const patient of detained) {
    const hours = ((Date.now() - new Date(patient.cleared_at).getTime()) / 3600000).toFixed(1);
    const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'wrongful_detention' AND status = 'open'`).get(patient.id);
    
    if (!existing) {
      db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        patient.id, 'wrongful_detention', 'critical',
        `Wrongful detention suspected: Patient medically cleared ${hours} hours ago but not physically discharged.`,
        JSON.stringify({ patient_id: patient.id, cleared_at: patient.cleared_at, hours_detained: hours }),
        0.9, 'rule_engine'
      );
      notifyPatient(patient.id, 'rights_info', '⚖️ Wrongful Detention Alert',
        `You were medically cleared ${hours} hours ago. Under Clinical Establishments Act Section 11, you cannot be held against your will after medical clearance.`);
    }
  }
  return detained.length;
}

// ═══════════════════════════════════════════════════
// FRAUD TYPE 9: EXTERNAL REPORT VIOLATION
// ═══════════════════════════════════════════════════
function flagExternalReportViolation(referralId, doctorId) {
  const db = getDb();
  const referral = db.prepare('SELECT * FROM referrals WHERE id = ?').get(referralId);
  if (!referral) return;

  const existing = db.prepare(`SELECT id FROM fraud_flags WHERE patient_id = ? AND flag_type = 'external_report_violation' AND evidence LIKE ?`).get(referral.patient_id, `%${referralId}%`);
  if (existing) return;

  db.prepare(`INSERT INTO fraud_flags (patient_id, flag_type, severity, description, evidence, flagged_against, ml_confidence_score, ml_model_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    referral.patient_id, 'external_report_violation', 'low',
    `External NABL-accredited lab report rejected without valid clinical reason.`,
    JSON.stringify({ referral_id: referralId, referred_to: referral.referred_to_name }),
    doctorId, 0.6, 'rule_engine'
  );
  notifyPatient(referral.patient_id, 'rights_info', '🧪 External Report Rights',
    'Your NABL-accredited external lab report was rejected. You are NOT required to re-take the test at the hospital lab.');
}

// ═══════════════════════════════════════════════════
// BOTTLENECK DETECTION
// ═══════════════════════════════════════════════════
function checkBottlenecks() {
  const db = getDb();
  const alerts = [];

  // Department bottleneck: >40% pending tasks in one dept
  const deptStats = db.prepare(`
    SELECT department, 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM discharge_tasks
    WHERE status = 'pending' OR (status = 'complete' AND completed_at > datetime('now', '-24 hours'))
    GROUP BY department
  `).all();

  for (const dept of deptStats) {
    if (dept.total > 0 && (dept.pending / dept.total) > 0.4) {
      alerts.push({ type: 'department_bottleneck', department: dept.department, pending: dept.pending, total: dept.total });
      notifyRole('admin', null, 'bottleneck', `⚠️ ${dept.department} Bottleneck`,
        `${dept.pending} of ${dept.total} discharge tasks pending in ${dept.department} department.`);
    }
  }

  // Patient waiting too long in DISCHARGING
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const stuckPatients = db.prepare(`
    SELECT p.*, psl.triggered_at as discharging_since
    FROM patients p
    JOIN patient_state_log psl ON p.id = psl.patient_id
    WHERE p.state = 'DISCHARGING'
    AND psl.to_state = 'DISCHARGING'
    AND psl.triggered_at < ?
  `).all(threeHoursAgo);

  for (const patient of stuckPatients) {
    alerts.push({ type: 'patient_critical', patient_id: patient.id, name: patient.name, hours: ((Date.now() - new Date(patient.discharging_since).getTime()) / 3600000).toFixed(1) });
  }

  return alerts;
}

// ═══════════════════════════════════════════════════
// RUN ALL FRAUD CHECKS
// ═══════════════════════════════════════════════════
async function runAllFraudChecks() {
  const results = {
    sink_tests: checkSinkTests(),
    wrongful_detention: checkWrongfulDetention(),
    bottlenecks: checkBottlenecks()
  };

  // Check extended stay for all admitted patients
  const db = getDb();
  const patients = db.prepare(`SELECT id FROM patients WHERE state IN ('ADMITTED', 'READY_SOON', 'DISCHARGING')`).all();
  results.extended_stay_checks = 0;
  for (const p of patients) {
    const r = checkExtendedStay(p.id);
    if (r) results.extended_stay_checks++;
  }

  // Check unbundling for all active bills
  const bills = db.prepare(`SELECT id FROM bills WHERE payment_status = 'pending'`).all();
  results.unbundling_checks = 0;
  for (const b of bills) {
    const r = checkUnbundling(b.id);
    if (r.length > 0) results.unbundling_checks++;
  }

  // Check kickback patterns for all doctors
  const doctors = db.prepare(`SELECT id FROM users WHERE role = 'doctor'`).all();
  for (const d of doctors) {
    await checkKickbackPatterns(d.id);
  }

  return results;
}

// ═══════════════════════════════════════════════════
// ML SERVICE INTEGRATION
// ═══════════════════════════════════════════════════
async function scoreBilling(patientId) {
  const db = getDb();
  const bill = db.prepare('SELECT * FROM bills WHERE patient_id = ?').get(patientId);
  if (!bill) return null;
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

  try {
    const response = await axios.post(`${ML_URL}/ml/score-billing`, {
      patient_id: patientId,
      bill_items: items,
      diagnosis_code: patient.diagnosis_code
    }, { timeout: 10000 });
    return response.data;
  } catch (e) {
    return { error: 'ML service unavailable', fallback: true };
  }
}

async function scoreJustification(justificationText, diagnosisCode, testName, outsideProtocol) {
  try {
    const response = await axios.post(`${ML_URL}/ml/score-justification`, {
      justification_text: justificationText,
      diagnosis_code: diagnosisCode,
      test_name: testName,
      outside_protocol: outsideProtocol
    }, { timeout: 30000 });
    return response.data;
  } catch (e) {
    return { validity_score: 0.5, is_clinically_valid: null, analysis_text: 'ML service unavailable', red_flags: [] };
  }
}

async function predictStay(diagnosisCode, age, wardType, currentDay) {
  try {
    const response = await axios.post(`${ML_URL}/ml/predict-stay`, {
      diagnosis_code: diagnosisCode, age, ward_type: wardType, current_day: currentDay
    }, { timeout: 10000 });
    return response.data;
  } catch (e) {
    return { predicted_days: null, error: 'ML service unavailable' };
  }
}

module.exports = {
  checkSinkTests, checkMedicineOvercharge, checkKickbackPatterns,
  checkExtendedStay, checkUnbundling, checkBillManipulation,
  flagEmergencyViolation, checkWrongfulDetention, flagExternalReportViolation,
  checkBottlenecks, runAllFraudChecks,
  scoreBilling, scoreJustification, predictStay
};
