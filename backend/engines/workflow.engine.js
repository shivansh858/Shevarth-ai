const { getDb } = require('../db/database');
const { notifyDepartment, notifyPatient, notifyRole } = require('../utils/notifications');
const { generateDraftBill } = require('./transparency.engine');

const VALID_TRANSITIONS = {
  'ADMITTED': ['READY_SOON', 'READY'],
  'READY_SOON': ['READY', 'ADMITTED'],
  'READY': ['DISCHARGING'],
  'DISCHARGING': ['DISCHARGED'],
  'DISCHARGED': ['BED_AVAILABLE'],
  'BED_AVAILABLE': []
};

function transitionState(patientId, toState, triggeredBy, reason) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new Error('Patient not found');

  const fromState = patient.state;
  if (!VALID_TRANSITIONS[fromState]?.includes(toState)) {
    throw new Error(`Invalid state transition: ${fromState} → ${toState}`);
  }

  // Update patient state
  db.prepare('UPDATE patients SET state = ? WHERE id = ?').run(toState, patientId);

  // Log transition
  db.prepare(`INSERT INTO patient_state_log (patient_id, from_state, to_state, triggered_by, reason) VALUES (?, ?, ?, ?, ?)`)
    .run(patientId, fromState, toState, triggeredBy, reason);

  // Trigger side effects
  if (toState === 'DISCHARGING') {
    onDischarging(patientId, triggeredBy);
  } else if (toState === 'DISCHARGED') {
    onDischarged(patientId, triggeredBy);
  } else if (toState === 'BED_AVAILABLE') {
    onBedAvailable(patientId, triggeredBy);
  }

  // Audit log
  db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(triggeredBy, 'state_transition', 'patient', patientId, JSON.stringify({ state: fromState }), JSON.stringify({ state: toState }));

  return { from: fromState, to: toState };
}

function onDischarging(patientId, triggeredBy) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

  // 1. Create discharge tasks for 4 departments
  const departments = [
    { department: 'Nursing', task_type: 'clinical_clearance', role: 'nurse' },
    { department: 'Pharmacy', task_type: 'medicine_reconciliation', role: 'pharmacy' },
    { department: 'Billing', task_type: 'final_bill_generation', role: 'billing' },
    { department: 'Housekeeping', task_type: 'bed_preparation', role: 'housekeeping' }
  ];

  for (const dept of departments) {
    const staff = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(dept.role);
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, assigned_to) VALUES (?, ?, ?, ?)`)
      .run(patientId, dept.department, dept.task_type, staff?.id || null);
    
    // Notify department
    notifyDepartment(dept.department, patientId, 'discharge_task',
      `📋 Discharge Task: ${patient.name}`,
      `${patient.name} (${patient.diagnosis}) is ready for discharge. Complete ${dept.task_type}.`);
  }

  // 2. Auto-generate draft bill
  try {
    generateDraftBill(patientId, triggeredBy);
  } catch (e) {
    console.error('Draft bill generation error:', e.message);
  }

  // 3. Notify patient
  notifyPatient(patientId, 'state_change', '🏥 Discharge Process Started',
    'Your doctor has approved discharge. The hospital is now processing your discharge tasks.');
}

function onDischarged(patientId, triggeredBy) {
  const db = getDb();
  db.prepare("UPDATE patients SET discharge_date = datetime('now') WHERE id = ?").run(patientId);
  
  // Create housekeeping task if not already created
  const existingTask = db.prepare(`SELECT id FROM discharge_tasks WHERE patient_id = ? AND department = 'Housekeeping' AND task_type = 'post_discharge_cleanup'`).get(patientId);
  if (!existingTask) {
    const housekeeper = db.prepare(`SELECT id FROM users WHERE role = 'housekeeping' LIMIT 1`).get();
    db.prepare(`INSERT INTO discharge_tasks (patient_id, department, task_type, assigned_to) VALUES (?, ?, ?, ?)`)
      .run(patientId, 'Housekeeping', 'post_discharge_cleanup', housekeeper?.id || null);
  }

  notifyPatient(patientId, 'state_change', '✅ Discharged',
    'You have been officially discharged. Thank you for choosing our hospital.');
}

function onBedAvailable(patientId, triggeredBy) {
  const db = getDb();
  notifyRole('admin', patientId, 'bed_available', '🛏️ Bed Available',
    `Bed ${db.prepare('SELECT bed_number FROM patients WHERE id = ?').get(patientId)?.bed_number || 'N/A'} is now available.`);
}

// Auto-discharge check: runs every 30 seconds
function checkAutoDischarge() {
  const db = getDb();
  const dischargingPatients = db.prepare(`SELECT id FROM patients WHERE state = 'DISCHARGING'`).all();

  for (const patient of dischargingPatients) {
    const tasks = db.prepare(`SELECT * FROM discharge_tasks WHERE patient_id = ? AND task_type != 'post_discharge_cleanup'`).all(patient.id);
    const allComplete = tasks.length > 0 && tasks.every(t => t.status === 'complete');
    
    const bill = db.prepare(`SELECT * FROM bills WHERE patient_id = ?`).get(patient.id);
    const billPaid = bill && bill.payment_status === 'paid';

    if (allComplete && billPaid) {
      transitionState(patient.id, 'DISCHARGED', null, 'Auto-discharge: all tasks complete and bill paid');
    }
  }
}

// Predict discharge
function predictReadySoon() {
  const db = getDb();
  const admitted = db.prepare(`SELECT p.*, ps.standard_stay_days FROM patients p JOIN protocol_standards ps ON p.diagnosis_code = ps.diagnosis_code WHERE p.state = 'ADMITTED'`).all();

  for (const patient of admitted) {
    const admissionDate = new Date(patient.admission_date);
    const currentDay = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));
    const hoursUntilStandard = (patient.standard_stay_days - currentDay) * 24;

    if (hoursUntilStandard > 0 && hoursUntilStandard <= 12) {
      if (patient.state !== 'READY_SOON') {
        transitionState(patient.id, 'READY_SOON', null, 'AI prediction: discharge expected within 12 hours');
      }
    }
  }
}

module.exports = { transitionState, checkAutoDischarge, predictReadySoon, VALID_TRANSITIONS };
