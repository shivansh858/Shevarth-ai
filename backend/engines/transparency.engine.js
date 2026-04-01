const { getDb } = require('../db/database');
const { computeBillHash } = require('../utils/hash');
const { notifyPatient } = require('../utils/notifications');

// Plain language translation map
const PLAIN_LANGUAGE_MAP = {
  'Hemoglobin A1c': 'Diabetes blood test (HbA1c)',
  'HbA1c': 'Diabetes blood test (HbA1c)',
  'CBC': 'Full blood count (Complete Blood Count)',
  'CBC with Differential': 'Full blood count with cell types',
  'LFT': 'Liver function tests',
  'RFT': 'Kidney function tests (Renal Function)',
  'Lipid Profile': 'Cholesterol and fat levels test',
  'Blood Culture': 'Blood infection detection test',
  'Widal Test': 'Typhoid fever detection test',
  'NS1 Antigen': 'Dengue fever early detection test',
  'Dengue IgM/IgG': 'Dengue antibody test',
  'ECG': 'Heart rhythm recording',
  'Troponin I': 'Heart attack marker test',
  'Chest X-Ray': 'Lung and chest imaging',
  'CT Brain': 'Brain scan (detailed imaging)',
  'CT Chest': 'Chest scan (detailed imaging)',
  'CT Abdomen': 'Stomach/abdomen scan',
  'MRI Brain': 'Detailed brain imaging (magnetic)',
  'MRI Knee': 'Detailed knee imaging (magnetic)',
  'Ultrasound Abdomen': 'Stomach/abdomen sound wave imaging',
  'Ultrasound KUB': 'Kidney/bladder sound wave imaging',
  'Urinalysis': 'Urine test',
  'Urine Routine': 'Standard urine test',
  'Urine Culture': 'Urine infection test',
  'Stool Routine': 'Stool examination',
  'Stool Culture': 'Stool infection test',
  'Coagulation Profile': 'Blood clotting test',
  'Blood Group': 'Blood type test',
  'HIV/HBsAg': 'HIV and Hepatitis B screening',
  'CRP': 'Inflammation marker test',
  'Procalcitonin': 'Infection severity marker test',
  'D-Dimer': 'Blood clot marker test',
  'ABG': 'Blood oxygen level test (Arterial Blood Gas)',
  'RT-PCR': 'COVID-19 detection test',
  'FBS': 'Fasting blood sugar test',
  'PPBS': 'Post-meal blood sugar test',
  '2D Echo': 'Heart ultrasound (Echocardiogram)',
  'Foley Catheter': 'Urine drainage tube (medical device)',
  'IV Cannula': 'IV drip needle device',
  'Stat Lab Processing': 'Urgent lab processing fee',
  'Room Charges': 'Daily hospital room fee',
  'Nursing Charges': 'Nursing care fee',
  'Consultation Fee': 'Doctor consultation fee',
  'OT Charges': 'Operation theatre usage fee',
  'Anesthesia': 'Pain prevention during surgery',
  'Dressings': 'Wound bandaging materials',
  'Physiotherapy': 'Physical rehabilitation exercises',
  'Malaria Parasite Test': 'Malaria detection blood test',
  'Peripheral Smear': 'Blood cell examination under microscope',
  'G6PD': 'Enzyme deficiency test (for malaria medication safety)',
  'Sputum Culture': 'Lung mucus infection test',
  'Electrolytes': 'Body salts/minerals balance test',
  'IL-6': 'Inflammation marker test (Interleukin-6)',
  'Ferritin': 'Iron storage level test',
  'Lactate': 'Body cell stress marker test',
  'A-Scan': 'Eye measurement scan for lens',
  'B-Scan': 'Eye ultrasound imaging',
  'MRCP': 'Bile duct imaging (non-invasive)',
  'GTT': 'Glucose tolerance test (diabetes screening)',
  'NST': 'Baby heart monitoring during pregnancy',
  'Fundoscopy': 'Eye back examination',
  'Carotid Doppler': 'Neck artery blood flow test',
  'PET-CT': 'Cancer detection full body scan',
  'Coronary Angiography': 'Heart artery X-ray with dye'
};

function getPlainLanguageName(technicalName) {
  if (PLAIN_LANGUAGE_MAP[technicalName]) return PLAIN_LANGUAGE_MAP[technicalName];
  // Fuzzy match
  const lowerName = technicalName.toLowerCase();
  for (const [key, value] of Object.entries(PLAIN_LANGUAGE_MAP)) {
    if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
      return value;
    }
  }
  return technicalName; // Return as-is if no translation
}

function addBillItem(billId, item, orderedBy) {
  const db = getDb();
  const plainName = getPlainLanguageName(item.item_name);
  const totalPrice = item.unit_price * (item.quantity || 1);
  const benchmarkPrice = item.benchmark_price || 0;
  const varianceFlag = benchmarkPrice > 0 && totalPrice > benchmarkPrice * 1.10 ? 1 : 0;

  // Check for duplicate
  const existing = db.prepare(
    'SELECT * FROM bill_items WHERE bill_id = ? AND item_name = ? AND ordered_by = ?'
  ).all(billId, item.item_name, orderedBy);
  const duplicateFlag = existing.length > 0 ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO bill_items (bill_id, item_name, plain_language_name, item_code, quantity, unit_price, total_price, benchmark_price, ordered_by, variance_flag, duplicate_flag, is_package_component, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    billId, item.item_name, plainName, item.item_code || null,
    item.quantity || 1, item.unit_price, totalPrice,
    benchmarkPrice, orderedBy, varianceFlag, duplicateFlag,
    item.is_package_component || 0, item.package_id || null
  );

  // Recalculate bill total
  recalculateBillTotal(billId);

  // Notify patient
  const bill = db.prepare('SELECT patient_id FROM bills WHERE id = ?').get(billId);
  if (bill) {
    notifyPatient(bill.patient_id, 'bill_update',
      'New charge added to your bill',
      `₹${totalPrice} — ${plainName}${varianceFlag ? ' ⚠️ Above benchmark rate' : ''}`
    );
  }

  return result.lastInsertRowid;
}

function recalculateBillTotal(billId) {
  const db = getDb();
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(billId);
  const total = items.reduce((sum, item) => sum + item.total_price, 0);
  
  // Categorize
  let pharmacy = 0, procedures = 0, consumables = 0;
  for (const item of items) {
    if (item.item_code && item.item_code.startsWith('MED-')) pharmacy += item.total_price;
    else if (item.item_code && item.item_code.startsWith('PROC-')) procedures += item.total_price;
    else if (item.item_code && item.item_code.startsWith('CON-')) consumables += item.total_price;
  }

  const hash = computeBillHash(items);
  db.prepare(`UPDATE bills SET total_amount = ?, pharmacy_total = ?, procedure_charges = ?, consumable_charges = ?, content_hash = ?, version = version + 1 WHERE id = ?`)
    .run(total, pharmacy, procedures, consumables, hash, billId);

  // Create version record
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  createBillVersion(billId, bill.version, items, hash, total, 'Item added/updated');
}

function createBillVersion(billId, versionNumber, items, hash, total, reason, changedBy) {
  const db = getDb();
  const snapshot = JSON.stringify(items);
  
  // Get previous version for diff
  const prevVersion = db.prepare(
    'SELECT snapshot FROM bill_versions WHERE bill_id = ? ORDER BY version_number DESC LIMIT 1'
  ).get(billId);
  
  let diff = null;
  if (prevVersion) {
    const prevItems = JSON.parse(prevVersion.snapshot);
    diff = computeDiff(prevItems, items);
  }

  db.prepare(`
    INSERT INTO bill_versions (bill_id, version_number, snapshot, content_hash, total_amount, change_reason, changed_by, diff_from_previous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(billId, versionNumber, snapshot, hash, total, reason, changedBy || null, diff ? JSON.stringify(diff) : null);
}

function computeDiff(oldItems, newItems) {
  const diff = { added: [], removed: [], modified: [] };
  const oldMap = new Map(oldItems.map(i => [i.id, i]));
  const newMap = new Map(newItems.map(i => [i.id, i]));

  for (const [id, item] of newMap) {
    if (!oldMap.has(id)) {
      diff.added.push({ item_name: item.item_name, total_price: item.total_price });
    } else {
      const old = oldMap.get(id);
      if (old.total_price !== item.total_price || old.quantity !== item.quantity) {
        diff.modified.push({
          item_name: item.item_name,
          old_price: old.total_price,
          new_price: item.total_price,
          old_qty: old.quantity,
          new_qty: item.quantity
        });
      }
    }
  }

  for (const [id, item] of oldMap) {
    if (!newMap.has(id)) {
      diff.removed.push({ item_name: item.item_name, total_price: item.total_price });
    }
  }

  return diff;
}

function validateNoMiscCharges(miscCharges) {
  if (miscCharges && miscCharges > 0) {
    throw new Error('Miscellaneous charges are not permitted. Every charge must be itemized with a name, reason, and benchmark.');
  }
}

function generateDraftBill(patientId, generatedBy) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new Error('Patient not found');

  // Check if bill already exists
  const existingBill = db.prepare('SELECT * FROM bills WHERE patient_id = ?').get(patientId);
  if (existingBill) return existingBill;

  const protocol = db.prepare('SELECT * FROM protocol_standards WHERE diagnosis_code = ?').get(patient.diagnosis_code);
  
  // Calculate room charges based on days
  const admissionDate = new Date(patient.admission_date);
  const now = new Date();
  const days = Math.max(1, Math.ceil((now - admissionDate) / (1000 * 60 * 60 * 24)));
  
  const roomRates = { general: 1500, icu: 8000, private: 5000 };
  const roomCharges = days * (roomRates[patient.ward_type] || 1500);
  const consultationFee = 1000;
  const nursingCharges = days * 500;

  const result = db.prepare(`
    INSERT INTO bills (patient_id, consultation_fee, room_charges, nursing_charges, total_amount, generated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(patientId, consultationFee, roomCharges, nursingCharges, consultationFee + roomCharges + nursingCharges, generatedBy);

  const billId = result.lastInsertRowid;

  // Add base bill items
  addBillItem(billId, { item_name: 'Consultation Fee', unit_price: consultationFee, benchmark_price: 800, item_code: 'SVC-CONSULT' }, patient.doctor_id);
  addBillItem(billId, { item_name: 'Room Charges', unit_price: roomCharges, benchmark_price: days * (patient.ward_type === 'general' ? 1000 : patient.ward_type === 'icu' ? 5000 : 3000), item_code: 'SVC-ROOM', quantity: 1 }, generatedBy);
  addBillItem(billId, { item_name: 'Nursing Charges', unit_price: nursingCharges, benchmark_price: days * 300, item_code: 'SVC-NURSE', quantity: 1 }, generatedBy);

  // Add test order charges
  const tests = db.prepare('SELECT * FROM test_orders WHERE patient_id = ?').all(patientId);
  for (const test of tests) {
    if (test.billed_amount > 0) {
      addBillItem(billId, { item_name: test.test_name, unit_price: test.billed_amount, benchmark_price: test.benchmark_amount, item_code: `TEST-${test.test_code || test.id}` }, test.doctor_id);
    }
  }

  // Add medicine charges
  const medicines = db.prepare(`
    SELECT mdl.*, mc.name as med_name FROM medicine_dispense_log mdl
    JOIN medicine_catalog mc ON mdl.medicine_id = mc.id
    WHERE mdl.patient_id = ?
  `).all(patientId);
  for (const med of medicines) {
    addBillItem(billId, { item_name: med.med_name, unit_price: med.unit_price_charged, quantity: med.quantity, benchmark_price: med.nppa_price * med.quantity, item_code: `MED-${med.medicine_id}` }, med.dispensed_by);
  }

  return db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
}

function getBillWithDetails(patientId) {
  const db = getDb();
  const bill = db.prepare('SELECT * FROM bills WHERE patient_id = ? ORDER BY id DESC LIMIT 1').get(patientId);
  if (!bill) return null;

  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY ordered_at ASC').all(bill.id);
  const versions = db.prepare('SELECT * FROM bill_versions WHERE bill_id = ? ORDER BY version_number ASC').all(bill.id);

  // Verify hash integrity
  const currentHash = computeBillHash(items);
  const hashValid = currentHash === bill.content_hash;

  return {
    ...bill,
    items,
    versions,
    hash_valid: hashValid,
    hash_mismatch: !hashValid
  };
}

module.exports = {
  getPlainLanguageName,
  addBillItem,
  recalculateBillTotal,
  createBillVersion,
  validateNoMiscCharges,
  generateDraftBill,
  getBillWithDetails,
  PLAIN_LANGUAGE_MAP
};
