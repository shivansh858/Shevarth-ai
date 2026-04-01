const { getDb } = require('../db/database');

function getPatientRights(patientId) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) return [];

  const rights = [];
  const protocol = db.prepare('SELECT * FROM protocol_standards WHERE diagnosis_code = ?').get(patient.diagnosis_code);
  const fraudFlags = db.prepare('SELECT * FROM fraud_flags WHERE patient_id = ? AND status = ?').all(patientId, 'open');

  // Always show these rights
  rights.push({
    id: 'itemized_bill',
    category: 'billing',
    icon: '📋',
    title: 'Right to Itemized Bill',
    description: 'You have the right to a complete itemized bill before making any payment. Every charge must be explained.',
    law: 'Clinical Establishments (Registration and Regulation) Act, 2010',
    always_show: true
  });

  rights.push({
    id: 'refuse_treatment',
    category: 'treatment',
    icon: '✋',
    title: 'Right to Refuse Treatment',
    description: 'You can refuse any treatment or procedure. Informed consent is mandatory before any procedure.',
    law: 'Indian Medical Council (Professional Conduct, Etiquette and Ethics) Regulations, 2002',
    always_show: true
  });

  rights.push({
    id: 'second_opinion',
    category: 'treatment',
    icon: '👨‍⚕️',
    title: 'Right to Second Opinion',
    description: 'You have the right to seek a second medical opinion from any registered medical practitioner.',
    law: 'Consumer Protection Act, 2019',
    always_show: true
  });

  rights.push({
    id: 'medical_records',
    category: 'information',
    icon: '📁',
    title: 'Right to Medical Records',
    description: 'You are entitled to copies of all your medical records, test results, and prescriptions.',
    law: 'Clinical Establishments Act, Section 10',
    always_show: true
  });

  // Emergency rights
  if (patient.is_emergency) {
    rights.push({
      id: 'emergency_care',
      category: 'emergency',
      icon: '🚨',
      title: 'Emergency Care Cannot Be Denied',
      description: 'Under the Clinical Establishments Act, you cannot be denied emergency treatment for non-payment. Any payment demand before stabilization is illegal.',
      law: 'Clinical Establishments (Registration and Regulation) Act, 2010, Section 11',
      severity: 'critical',
      active: true
    });
  }

  // Extended stay rights
  if (protocol) {
    const admissionDate = new Date(patient.admission_date);
    const currentDay = Math.ceil((Date.now() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (currentDay > protocol.standard_stay_days) {
      rights.push({
        id: 'voluntary_discharge',
        category: 'stay',
        icon: '🚪',
        title: 'Right to Voluntary Discharge',
        description: `Your stay has exceeded the standard ${protocol.standard_stay_days} days for ${protocol.diagnosis_name} (you are on Day ${currentDay}). You have the legal right to request voluntary discharge at any time.`,
        law: 'Indian Medical Council Regulations',
        severity: 'warning',
        active: true,
        data: { currentDay, standardDays: protocol.standard_stay_days }
      });
    }
  }

  // Insurance rights
  if (patient.insurance_provider) {
    rights.push({
      id: 'insurance_transparency',
      category: 'insurance',
      icon: '🛡️',
      title: 'Insurance Bill Transparency',
      description: `Your insurer (${patient.insurance_provider}) must receive the same itemized bill as you. You can request your bill copy at any time. Any difference between the bill submitted to insurance and what you see is a violation.`,
      law: 'Insurance Regulatory and Development Authority of India (IRDAI) Guidelines',
      active: true
    });
  }

  // Fraud flags present
  if (fraudFlags.length > 0) {
    rights.push({
      id: 'billing_issues',
      category: 'billing',
      icon: '⚠️',
      title: 'Billing Issues Detected',
      description: `${fraudFlags.length} issue(s) have been detected in your billing. Review them in the billing section and raise a dispute if needed. You are not required to pay disputed amounts until resolution.`,
      severity: 'warning',
      active: true,
      data: { flag_count: fraudFlags.length, flags: fraudFlags.map(f => f.flag_type) }
    });
  }

  // External report rights
  const referrals = db.prepare('SELECT * FROM referrals WHERE patient_id = ?').all(patientId);
  if (referrals.length > 0) {
    rights.push({
      id: 'external_reports',
      category: 'treatment',
      icon: '🧪',
      title: 'External Lab Report Rights',
      description: 'You have the right to get tests done from any NABL-accredited lab. The hospital cannot reject valid external reports without a documented clinical reason.',
      law: 'Clinical Establishments Act',
      active: true
    });
  }

  return rights;
}

function checkGovtSchemeEligibility(patientId) {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) return [];

  const schemes = [];

  // Ayushman Bharat (PM-JAY) — for BPL families, general ward, no insurance
  if (patient.ward_type === 'general' && !patient.insurance_provider) {
    schemes.push({
      id: 'ayushman_bharat',
      name: 'Ayushman Bharat - PM-JAY',
      description: 'Provides health coverage up to ₹5 lakh per family per year for secondary and tertiary hospitalization.',
      coverage: 500000,
      eligibility_reason: 'General ward admission without insurance',
      how_to_apply: 'Visit the Ayushman Mitra counter at the hospital or call 14555'
    });
  }

  // Ayushman Bharat Vaya Vandana — age > 70
  if (patient.age > 70) {
    schemes.push({
      id: 'vaya_vandana',
      name: 'Ayushman Bharat - Vaya Vandana',
      description: 'Health coverage for senior citizens above 70 years, regardless of income.',
      coverage: 500000,
      eligibility_reason: 'Patient age above 70 years',
      how_to_apply: 'Provide Aadhaar card at the Ayushman counter'
    });
  }

  // State schemes
  if (patient.is_emergency) {
    schemes.push({
      id: 'emergency_fund',
      name: 'State Emergency Medical Fund',
      description: 'Financial assistance for emergency medical treatment for economically weaker sections.',
      coverage: 200000,
      eligibility_reason: 'Emergency admission',
      how_to_apply: 'Hospital social worker can assist with application'
    });
  }

  // CGHS for government employees
  schemes.push({
    id: 'cghs',
    name: 'CGHS (Central Govt Health Scheme)',
    description: 'If you are a central government employee or pensioner, you are covered under CGHS with prescribed rates.',
    coverage: null,
    eligibility_reason: 'Check if applicable — for central government employees',
    how_to_apply: 'Present CGHS card at billing counter'
  });

  return schemes;
}

function getDisputeOptions() {
  return [
    { type: 'overcharge', label: 'Overcharged', description: 'The amount charged is higher than the benchmark/market rate' },
    { type: 'not_received', label: 'Service Not Received', description: 'I was charged for a service or medicine I did not receive' },
    { type: 'duplicate', label: 'Duplicate Charge', description: 'I see the same charge appearing more than once' },
    { type: 'wrong_code', label: 'Wrong Code/Item', description: 'The billing code or item name does not match the actual service' },
    { type: 'service_not_rendered', label: 'Service Not Rendered', description: 'The procedure or test was not actually performed' }
  ];
}

module.exports = { getPatientRights, checkGovtSchemeEligibility, getDisputeOptions };
