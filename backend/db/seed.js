const { getDb, initializeDb } = require('./database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 12;

async function seed() {
  const db = initializeDb();
  console.log('🌱 Starting database seed...');

  // Clear existing data
  const tables = [
    'audit_log', 'notifications', 'emergency_admissions', 'disputes',
    'referral_patterns', 'fraud_flags', 'stay_justifications', 'referrals',
    'bill_items', 'bill_versions', 'bills', 'medicine_dispense_log',
    'discharge_tasks', 'test_orders', 'patient_state_log', 'patients',
    'nabl_labs', 'consumable_catalog', 'medicine_catalog',
    'procedure_packages', 'protocol_standards', 'users'
  ];
  for (const t of tables) {
    db.exec(`DELETE FROM ${t}`);
  }

  // ═══════════════════════════════════════════════════
  // USERS (Staff)
  // ═══════════════════════════════════════════════════
  const adminHash = await bcrypt.hash('Admin@123', SALT_ROUNDS);
  const doctorHash = await bcrypt.hash('Doctor@123', SALT_ROUNDS);
  const doctor2Hash = await bcrypt.hash('Doctor@123', SALT_ROUNDS);
  const nurseHash = await bcrypt.hash('Nurse@123', SALT_ROUNDS);
  const pharmacyHash = await bcrypt.hash('Pharmacy@123', SALT_ROUNDS);
  const billingHash = await bcrypt.hash('Billing@123', SALT_ROUNDS);
  const housekeepingHash = await bcrypt.hash('House@123', SALT_ROUNDS);

  const insertUser = db.prepare(`INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)`);
  
  insertUser.run('Admin', 'admin@sevaarth.com', adminHash, 'admin', 'Administration');
  insertUser.run('Dr. Arjun Mehta', 'doctor@sevaarth.com', doctorHash, 'doctor', 'Medicine');
  insertUser.run('Dr. Priya Sharma', 'doctor2@sevaarth.com', doctor2Hash, 'doctor', 'Surgery');
  insertUser.run('Nurse Kavita', 'nurse@sevaarth.com', nurseHash, 'nurse', 'Nursing');
  insertUser.run('Rajan Pharmacy', 'pharmacy@sevaarth.com', pharmacyHash, 'pharmacy', 'Pharmacy');
  insertUser.run('Billing Officer Suresh', 'billing@sevaarth.com', billingHash, 'billing', 'Billing');
  insertUser.run('Housekeeping Ram', 'housekeeping@sevaarth.com', housekeepingHash, 'housekeeping', 'Housekeeping');

  console.log('  ✅ Staff users created');

  // ═══════════════════════════════════════════════════
  // PROTOCOL STANDARDS (20 diagnoses)
  // ═══════════════════════════════════════════════════
  const insertProtocol = db.prepare(`INSERT INTO protocol_standards (diagnosis_code, diagnosis_name, required_tests, optional_tests, standard_stay_days, max_stay_days, max_cost_benchmark) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const protocols = [
    ['A01.0', 'Typhoid Fever', JSON.stringify(['CBC','Blood Culture','Widal Test','LFT']), JSON.stringify(['Urine Culture','Stool Culture']), 7, 14, 45000],
    ['A90', 'Dengue Fever', JSON.stringify(['CBC','NS1 Antigen','Dengue IgM/IgG','LFT']), JSON.stringify(['Coagulation Profile','Chest X-Ray']), 5, 10, 35000],
    ['B50.9', 'Malaria', JSON.stringify(['Malaria Parasite Test','CBC','LFT','RFT']), JSON.stringify(['G6PD','Peripheral Smear']), 5, 10, 30000],
    ['K35.80', 'Appendectomy', JSON.stringify(['CBC','Ultrasound Abdomen','Urinalysis','Coagulation Profile']), JSON.stringify(['CT Abdomen']), 3, 7, 80000],
    ['O80', 'Normal Delivery', JSON.stringify(['CBC','Blood Group','HIV/HBsAg','Urinalysis','Ultrasound']), JSON.stringify(['GTT','NST']), 3, 5, 40000],
    ['O82', 'Cesarean Section', JSON.stringify(['CBC','Blood Group','HIV/HBsAg','Coagulation Profile','ECG']), JSON.stringify(['Ultrasound','NST']), 5, 8, 90000],
    ['I21.9', 'Chest Pain/ACS', JSON.stringify(['ECG','Troponin I','CBC','RFT','Lipid Profile']), JSON.stringify(['2D Echo','Coronary Angiography','Chest X-Ray']), 5, 10, 150000],
    ['E11.9', 'Diabetes Mellitus Type 2', JSON.stringify(['FBS','PPBS','HbA1c','RFT','Lipid Profile']), JSON.stringify(['Urine Microalbumin','Fundoscopy']), 3, 7, 25000],
    ['I10', 'Hypertension', JSON.stringify(['ECG','RFT','Lipid Profile','Urine Routine']), JSON.stringify(['2D Echo','Fundoscopy']), 2, 5, 20000],
    ['J18.9', 'Pneumonia', JSON.stringify(['CBC','Chest X-Ray','Sputum Culture','Blood Culture']), JSON.stringify(['CT Chest','ABG','Procalcitonin']), 5, 10, 50000],
    ['N39.0', 'Urinary Tract Infection', JSON.stringify(['Urine Routine','Urine Culture','CBC','RFT']), JSON.stringify(['Ultrasound KUB','CT KUB']), 3, 7, 20000],
    ['S72.90', 'Fracture (Femur)', JSON.stringify(['X-Ray','CBC','Coagulation Profile','Blood Group']), JSON.stringify(['CT Scan','MRI']), 7, 14, 200000],
    ['I63.9', 'Stroke', JSON.stringify(['CT Brain','CBC','RFT','Blood Sugar','Lipid Profile','ECG']), JSON.stringify(['MRI Brain','Carotid Doppler','2D Echo']), 7, 14, 180000],
    ['A09', 'Acute Gastroenteritis', JSON.stringify(['CBC','Stool Routine','RFT','Electrolytes']), JSON.stringify(['Stool Culture','Abdominal X-Ray']), 3, 5, 15000],
    ['U07.1', 'COVID-19', JSON.stringify(['RT-PCR','CBC','CRP','D-Dimer','Chest X-Ray','LFT']), JSON.stringify(['CT Chest','IL-6','Ferritin','Procalcitonin']), 10, 21, 200000],
    ['M17.11', 'Knee Replacement', JSON.stringify(['CBC','RFT','ECG','Chest X-Ray','Blood Group','Coagulation Profile']), JSON.stringify(['MRI Knee','2D Echo']), 7, 14, 350000],
    ['H25.9', 'Cataract Surgery', JSON.stringify(['CBC','Blood Sugar','ECG']), JSON.stringify(['A-Scan','B-Scan']), 1, 2, 45000],
    ['K40.90', 'Hernia Repair', JSON.stringify(['CBC','Ultrasound Abdomen','ECG','Coagulation Profile']), JSON.stringify(['CT Abdomen']), 3, 5, 70000],
    ['K80.20', 'Cholecystectomy', JSON.stringify(['CBC','LFT','Ultrasound Abdomen','Coagulation Profile']), JSON.stringify(['MRCP','CT Abdomen']), 3, 7, 90000],
    ['A41.9', 'Sepsis', JSON.stringify(['CBC','Blood Culture','CRP','Procalcitonin','RFT','LFT','ABG','Lactate']), JSON.stringify(['CT Chest','Urine Culture']), 10, 21, 250000]
  ];

  for (const p of protocols) {
    insertProtocol.run(...p);
  }
  console.log('  ✅ 20 protocol standards created');

  // ═══════════════════════════════════════════════════
  // MEDICINE CATALOG (30 medicines)
  // ═══════════════════════════════════════════════════
  const insertMedicine = db.prepare(`INSERT INTO medicine_catalog (name, generic_name, brand_name, is_private_label, nppa_ceiling_price, cghs_rate, hospital_rate, markup_percentage, generic_equivalent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const medicines = [
    // Overcharged medicines (10)
    ['Paracetamol 500mg', 'Paracetamol', 'Calpol', 0, 12, 10, 340, 2733, null],
    ['Amoxicillin 500mg', 'Amoxicillin', 'Amoxil', 0, 210, 180, 840, 300, null],
    ['Ranitidine 150mg', 'Ranitidine', 'Zinetac', 0, 18, 15, 185, 928, null],
    ['Metformin 500mg', 'Metformin', 'Glycomet', 0, 25, 22, 290, 1060, null],
    ['Ciprofloxacin 500mg', 'Ciprofloxacin', 'Ciplox', 0, 35, 30, 420, 1100, null],
    ['Pantoprazole 40mg', 'Pantoprazole', 'Pan 40', 0, 28, 25, 345, 1132, null],
    ['Azithromycin 500mg', 'Azithromycin', 'Azithral', 0, 65, 55, 580, 792, null],
    ['Diclofenac 50mg', 'Diclofenac', 'Voveran', 0, 15, 12, 180, 1100, null],
    ['Ceftriaxone 1g Inj', 'Ceftriaxone', 'Monocef', 0, 45, 40, 890, 1878, null],
    ['Cefixime 200mg', 'Cefixime', 'Zifi', 0, 55, 48, 450, 718, null],
    // Private label with generics (8)
    ['HospiBrand Paracetamol Plus', 'Paracetamol', null, 1, 12, 10, 95, 692, 1],
    ['HospiBrand Antacid Forte', 'Ranitidine', null, 1, 18, 15, 120, 567, 3],
    ['HospiBrand Sugar Control', 'Metformin', null, 1, 25, 22, 180, 620, 4],
    ['HospiBrand Antibiotic Plus', 'Amoxicillin', null, 1, 210, 180, 520, 148, 2],
    ['HospiBrand Pain Relief', 'Diclofenac', null, 1, 15, 12, 110, 633, 8],
    ['HospiBrand Gastro Shield', 'Pantoprazole', null, 1, 28, 25, 190, 579, 6],
    ['HospiBrand Infection Guard', 'Ciprofloxacin', null, 1, 35, 30, 250, 614, 5],
    ['HospiBrand Cef-X', 'Cefixime', null, 1, 55, 48, 280, 409, 10],
    // Fair priced medicines (12)
    ['Ondansetron 4mg', 'Ondansetron', 'Emeset', 0, 28, 25, 95, 239, null],
    ['Omeprazole 20mg', 'Omeprazole', 'Omez', 0, 35, 30, 40, 14, null],
    ['Atorvastatin 10mg', 'Atorvastatin', 'Atorva', 0, 45, 40, 52, 16, null],
    ['Amlodipine 5mg', 'Amlodipine', 'Amlong', 0, 20, 18, 24, 20, null],
    ['Losartan 50mg', 'Losartan', 'Losar', 0, 30, 25, 35, 17, null],
    ['Metoprolol 50mg', 'Metoprolol', 'Betaloc', 0, 18, 16, 22, 22, null],
    ['Aspirin 75mg', 'Aspirin', 'Ecosprin', 0, 8, 7, 10, 25, null],
    ['Insulin Glargine', 'Insulin', 'Lantus', 0, 580, 520, 650, 12, null],
    ['Enoxaparin 40mg Inj', 'Enoxaparin', 'Clexane', 0, 350, 300, 390, 11, null],
    ['Normal Saline 500ml', 'NaCl 0.9%', null, 0, 25, 22, 28, 12, null],
    ['Dextrose 5% 500ml', 'Dextrose', null, 0, 30, 25, 34, 13, null],
    ['Tramadol 50mg', 'Tramadol', 'Ultracet', 0, 22, 20, 26, 18, null]
  ];

  for (const m of medicines) {
    insertMedicine.run(...m);
  }
  console.log('  ✅ 30 medicines in catalog');

  // ═══════════════════════════════════════════════════
  // PROCEDURE PACKAGES (10)
  // ═══════════════════════════════════════════════════
  const insertPackage = db.prepare(`INSERT INTO procedure_packages (procedure_name, procedure_code, package_price_cghs, package_price_market, included_components, exclusions) VALUES (?, ?, ?, ?, ?, ?)`);

  const packages = [
    ['Appendectomy (Open)', 'SURG-APP-001', 25000, 55000, JSON.stringify(['Surgery','Anesthesia','OT Charges','Surgeon Fee','Post-op Care 3 days','Dressings','Antibiotics']), JSON.stringify(['ICU if needed','Blood transfusion'])],
    ['Normal Delivery', 'OBS-ND-001', 12000, 30000, JSON.stringify(['Delivery Charges','Room 3 days','Nursing Care','Baby Care','Routine Medicines','Routine Tests']), JSON.stringify(['NICU','C-section conversion'])],
    ['Cesarean Section', 'OBS-CS-001', 22000, 65000, JSON.stringify(['Surgery','Anesthesia','OT Charges','Room 5 days','Nursing','Baby Care','Medicines','Routine Tests']), JSON.stringify(['NICU','Blood transfusion','Extended ICU'])],
    ['Total Knee Replacement', 'ORTH-TKR-001', 150000, 320000, JSON.stringify(['Surgery','Implant','Anesthesia','OT Charges','Room 7 days','Physiotherapy','Medicines','Tests']), JSON.stringify(['Revision surgery','Extended rehab'])],
    ['Cataract Surgery (Phaco)', 'OPH-CAT-001', 15000, 40000, JSON.stringify(['Surgery','IOL Lens','Medicines','Follow-up 2 visits']), JSON.stringify(['Premium IOL','Complications management'])],
    ['Hernia Repair (Lap)', 'SURG-HRN-001', 20000, 55000, JSON.stringify(['Surgery','Mesh','Anesthesia','OT Charges','Room 2 days','Medicines']), JSON.stringify(['Open conversion','Extended stay'])],
    ['Cholecystectomy (Lap)', 'SURG-CHO-001', 18000, 50000, JSON.stringify(['Surgery','Anesthesia','OT Charges','Room 3 days','Medicines','Tests']), JSON.stringify(['Open conversion','ERCP if needed'])],
    ['Hip Replacement', 'ORTH-THR-001', 175000, 380000, JSON.stringify(['Surgery','Implant','Anesthesia','OT Charges','Room 10 days','Physiotherapy','Medicines']), JSON.stringify(['Revision surgery','Blood transfusion'])],
    ['Cardiac Catheterization', 'CARD-CATH-001', 25000, 65000, JSON.stringify(['Procedure','Cath Lab Charges','Contrast','Monitoring','Room 2 days','Medicines']), JSON.stringify(['Angioplasty','Stent','CABG'])],
    ['Laparoscopic Cholecystectomy', 'SURG-LCHO-001', 22000, 55000, JSON.stringify(['Surgery','Anesthesia','Laparoscopic Equipment','Room 2 days','Medicines','Tests']), JSON.stringify(['Conversion to open','CBD exploration'])]
  ];

  for (const p of packages) {
    insertPackage.run(...p);
  }
  console.log('  ✅ 10 procedure packages created');

  // ═══════════════════════════════════════════════════
  // CONSUMABLE CATALOG
  // ═══════════════════════════════════════════════════
  const insertConsumable = db.prepare(`INSERT INTO consumable_catalog (name, government_rate, hospital_rate, standard_procedures) VALUES (?, ?, ?, ?)`);
  
  const consumables = [
    ['Disposable Syringe 5ml', 5, 45, JSON.stringify(['All'])],
    ['IV Cannula 20G', 15, 180, JSON.stringify(['All IV procedures'])],
    ['Foley Catheter', 40, 450, JSON.stringify(['Catheterization'])],
    ['Surgical Gloves (pair)', 8, 55, JSON.stringify(['All procedures'])],
    ['Crepe Bandage 6"', 25, 220, JSON.stringify(['Dressings','Fractures'])],
    ['PPE Kit', 80, 850, JSON.stringify(['COVID-19','Isolation'])],
    ['N95 Mask', 15, 180, JSON.stringify(['COVID-19','Isolation'])],
    ['Oxygen Mask', 20, 250, JSON.stringify(['Respiratory conditions'])],
    ['ECG Electrodes (set)', 30, 350, JSON.stringify(['Cardiac monitoring'])],
    ['Suture Kit', 60, 580, JSON.stringify(['Wound closure','Surgery'])]
  ];

  for (const c of consumables) {
    insertConsumable.run(...c);
  }
  console.log('  ✅ Consumable catalog created');

  // ═══════════════════════════════════════════════════
  // NABL LABS (15)
  // ═══════════════════════════════════════════════════
  const insertLab = db.prepare(`INSERT INTO nabl_labs (name, nabl_number, location, test_catalog, avg_rates) VALUES (?, ?, ?, ?, ?)`);

  const labs = [
    ['Thyrocare', 'MC-3456', 'Mumbai', JSON.stringify(['CBC','LFT','RFT','Thyroid Profile','Lipid Profile','HbA1c']), JSON.stringify({CBC:250,LFT:450,RFT:400})],
    ['SRL Diagnostics', 'MC-2891', 'Mumbai', JSON.stringify(['CBC','Blood Culture','Hormones','Cancer Markers']), JSON.stringify({CBC:300,BloodCulture:800})],
    ['Metropolis', 'MC-1247', 'Mumbai', JSON.stringify(['CBC','Histopathology','Molecular Tests','Genetics']), JSON.stringify({CBC:280,Histopathology:1200})],
    ['Dr. Lal PathLabs', 'MC-0892', 'Delhi', JSON.stringify(['CBC','Allergy Panel','Autoimmune','Metabolic']), JSON.stringify({CBC:260,AllergyPanel:2500})],
    ['Niramaya', 'MC-4521', 'Pune', JSON.stringify(['CBC','LFT','RFT','Urinalysis']), JSON.stringify({CBC:200,LFT:380})],
    ['Suburban Diagnostics', 'MC-3789', 'Mumbai', JSON.stringify(['CBC','Imaging','Cardiac Tests']), JSON.stringify({CBC:270,ECG:350})],
    ['Kokilaben Lab', 'MC-5643', 'Mumbai', JSON.stringify(['CBC','Advanced Genetics','Cancer Markers']), JSON.stringify({CBC:350,GeneticPanel:5000})],
    ['Max Lab', 'MC-6234', 'Delhi', JSON.stringify(['CBC','LFT','RFT','Hormones','Vitamins']), JSON.stringify({CBC:300,VitaminPanel:1800})],
    ['Fortis Lab', 'MC-7812', 'Gurgaon', JSON.stringify(['CBC','Cardiac Markers','Coagulation']), JSON.stringify({CBC:320,Troponin:650})],
    ['Medanta Lab', 'MC-8901', 'Gurgaon', JSON.stringify(['CBC','Transplant Panel','Immunology']), JSON.stringify({CBC:340,TransplantPanel:8000})],
    ['Apollo Diagnostics', 'MC-9123', 'Chennai', JSON.stringify(['CBC','LFT','RFT','Full Body Panel']), JSON.stringify({CBC:280,FullBodyPanel:3500})],
    ['Mahajan Imaging', 'MC-1567', 'Delhi', JSON.stringify(['MRI','CT Scan','X-Ray','Ultrasound','PET-CT']), JSON.stringify({MRI:5000,CT:3500,XRay:500})],
    ['Cloudnine Lab', 'MC-2345', 'Bangalore', JSON.stringify(['CBC','Prenatal Panel','Pediatric Panel']), JSON.stringify({CBC:250,PrenatalPanel:2000})],
    ['Religare', 'MC-3678', 'Delhi', JSON.stringify(['CBC','Wellness Panel','Executive Health']), JSON.stringify({CBC:290,WellnessPanel:3000})],
    ['Healthians', 'MC-4890', 'Gurgaon', JSON.stringify(['CBC','Thyroid','Diabetes Panel','Liver Panel']), JSON.stringify({CBC:220,ThyroidPanel:600})]
  ];

  for (const l of labs) {
    insertLab.run(...l);
  }
  console.log('  ✅ 15 NABL labs created');

  console.log('\n🎉 Seed complete! Default credentials:');
  console.log('  admin@sevaarth.com     / Admin@123');
  console.log('  doctor@sevaarth.com    / Doctor@123');
  console.log('  doctor2@sevaarth.com   / Doctor@123');
  console.log('  nurse@sevaarth.com     / Nurse@123');
  console.log('  pharmacy@sevaarth.com  / Pharmacy@123');
  console.log('  billing@sevaarth.com   / Billing@123');
  console.log('  housekeeping@sevaarth.com / House@123');
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
