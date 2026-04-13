-- ═══════════════════════════════════════════════════════════
-- SEVAARTH PATIENT PROTECTION OS — DATABASE SCHEMA
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','doctor','nurse','pharmacy','billing','housekeeping','patient')),
  department TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  gender TEXT NOT NULL CHECK(gender IN ('Male','Female','Other')),
  phone TEXT,
  emergency_contact TEXT,
  diagnosis TEXT NOT NULL,
  diagnosis_code TEXT NOT NULL,
  admission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  ward_type TEXT NOT NULL CHECK(ward_type IN ('general','icu','private')),
  bed_number TEXT,
  doctor_id INTEGER REFERENCES users(id),
  insurance_provider TEXT,
  insurance_id TEXT,
  is_emergency INTEGER DEFAULT 0,
  state TEXT DEFAULT 'ADMITTED' CHECK(state IN ('ADMITTED','READY_SOON','READY','DISCHARGING','DISCHARGED','BED_AVAILABLE')),
  discharge_date DATETIME,
  qr_token TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_state_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  triggered_by INTEGER REFERENCES users(id),
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS discharge_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  department TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','complete')),
  assigned_to INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  completed_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS test_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  test_name TEXT NOT NULL,
  test_code TEXT,
  is_in_protocol INTEGER DEFAULT 1,
  justification TEXT,
  approver_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'ordered' CHECK(status IN ('ordered','collected','processing','resulted','reviewed')),
  result_uploaded_at DATETIME,
  result_file_path TEXT,
  billed_amount REAL DEFAULT 0,
  benchmark_amount REAL DEFAULT 0,
  sink_test_flag INTEGER DEFAULT 0,
  nlp_justification_score REAL,
  nlp_justification_analysis TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS protocol_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diagnosis_code TEXT UNIQUE NOT NULL,
  diagnosis_name TEXT NOT NULL,
  required_tests TEXT DEFAULT '[]',
  optional_tests TEXT DEFAULT '[]',
  standard_stay_days INTEGER NOT NULL,
  max_stay_days INTEGER NOT NULL,
  max_cost_benchmark REAL
);

CREATE TABLE IF NOT EXISTS medicine_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  generic_name TEXT,
  brand_name TEXT,
  is_private_label INTEGER DEFAULT 0,
  nppa_ceiling_price REAL,
  cghs_rate REAL,
  hospital_rate REAL,
  markup_percentage REAL,
  generic_equivalent_id INTEGER REFERENCES medicine_catalog(id)
);

CREATE TABLE IF NOT EXISTS consumable_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  government_rate REAL,
  hospital_rate REAL,
  standard_procedures TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS medicine_dispense_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  medicine_id INTEGER NOT NULL REFERENCES medicine_catalog(id),
  quantity INTEGER NOT NULL,
  unit_price_charged REAL NOT NULL,
  nppa_price REAL,
  variance_amount REAL,
  generic_offered INTEGER DEFAULT 0,
  generic_accepted INTEGER DEFAULT 0,
  dispensed_by INTEGER REFERENCES users(id),
  dispensed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  overcharge_flag INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  version INTEGER DEFAULT 1,
  content_hash TEXT,
  consultation_fee REAL DEFAULT 0,
  room_charges REAL DEFAULT 0,
  pharmacy_total REAL DEFAULT 0,
  nursing_charges REAL DEFAULT 0,
  procedure_charges REAL DEFAULT 0,
  consumable_charges REAL DEFAULT 0,
  misc_charges REAL DEFAULT 0 CHECK(misc_charges = 0),
  total_amount REAL DEFAULT 0,
  payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','disputed')),
  generated_by INTEGER REFERENCES users(id),
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME
);

CREATE TABLE IF NOT EXISTS bill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  version_number INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  total_amount REAL NOT NULL,
  change_reason TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  diff_from_previous TEXT
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  item_name TEXT NOT NULL,
  plain_language_name TEXT,
  item_code TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,
  benchmark_price REAL,
  ordered_by INTEGER REFERENCES users(id),
  ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  variance_flag INTEGER DEFAULT 0,
  duplicate_flag INTEGER DEFAULT 0,
  is_package_component INTEGER DEFAULT 0,
  package_id INTEGER REFERENCES procedure_packages(id)
);

CREATE TABLE IF NOT EXISTS procedure_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_name TEXT NOT NULL,
  procedure_code TEXT UNIQUE,
  package_price_cghs REAL,
  package_price_market REAL,
  included_components TEXT DEFAULT '[]',
  exclusions TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  referred_to_name TEXT NOT NULL,
  referred_to_type TEXT NOT NULL CHECK(referred_to_type IN ('lab','specialist','imaging')),
  clinical_justification TEXT,
  is_mandatory INTEGER DEFAULT 0,
  alternatives_shown INTEGER DEFAULT 0,
  external_report_submitted INTEGER DEFAULT 0,
  report_rejected INTEGER DEFAULT 0,
  rejection_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stay_justifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  day_number INTEGER NOT NULL,
  clinical_reason TEXT NOT NULL,
  criteria_not_met TEXT DEFAULT '[]',
  expected_discharge DATETIME,
  is_insurance_case INTEGER DEFAULT 0,
  weak_justification_flag INTEGER DEFAULT 0,
  nlp_validity_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER REFERENCES patients(id),
  flag_type TEXT NOT NULL CHECK(flag_type IN ('overcharge','sink_test','unbundling','duplicate','kickback','manipulation','emergency_violation','wrongful_detention','external_report_violation','extended_stay')),
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  evidence TEXT DEFAULT '{}',
  flagged_against INTEGER REFERENCES users(id),
  ml_confidence_score REAL,
  ml_model_used TEXT,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','reviewed','resolved','escalated')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referral_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  referred_to_name TEXT NOT NULL,
  referral_count_30d INTEGER DEFAULT 0,
  referral_percentage REAL DEFAULT 0,
  cluster_id INTEGER,
  anomaly_score REAL,
  flagged INTEGER DEFAULT 0,
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  bill_item_id INTEGER REFERENCES bill_items(id),
  dispute_type TEXT NOT NULL CHECK(dispute_type IN ('overcharge','not_received','duplicate','wrong_code','service_not_rendered')),
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','under_review','resolved','rejected')),
  raised_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES users(id),
  refund_amount REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emergency_admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  arrival_time DATETIME NOT NULL,
  first_treatment_time DATETIME,
  response_minutes INTEGER,
  payment_demanded_before_treatment INTEGER DEFAULT 0,
  payment_demand_by INTEGER REFERENCES users(id),
  govt_scheme_eligible INTEGER DEFAULT 0,
  scheme_name TEXT,
  wrongful_detention INTEGER DEFAULT 0,
  detention_hours REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  patient_id INTEGER REFERENCES patients(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nabl_labs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nabl_number TEXT UNIQUE NOT NULL,
  location TEXT,
  test_catalog TEXT DEFAULT '[]',
  avg_rates TEXT DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patients_state ON patients(state);
CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients(doctor_id);
CREATE INDEX IF NOT EXISTS idx_patients_qr ON patients(qr_token);
CREATE INDEX IF NOT EXISTS idx_discharge_tasks_patient ON discharge_tasks(patient_id);
CREATE INDEX IF NOT EXISTS idx_discharge_tasks_status ON discharge_tasks(status);
CREATE INDEX IF NOT EXISTS idx_test_orders_patient ON test_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_test_orders_doctor ON test_orders(doctor_id);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_patient ON fraud_flags(patient_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_status ON fraud_flags(status);
CREATE INDEX IF NOT EXISTS idx_referrals_doctor ON referrals(doctor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_medicine_dispense_patient ON medicine_dispense_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_stay_justifications_patient ON stay_justifications(patient_id);
