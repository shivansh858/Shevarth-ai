const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

function getToken() {
  return localStorage.getItem('sevaarth_token')
}

function headers() {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  // Auth
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),

  // Admin
  bedGrid: () => request('GET', '/admin/bed-grid'),
  compliance: () => request('GET', '/admin/compliance'),
  staff: () => request('GET', '/admin/staff'),
  createStaff: (data) => request('POST', '/admin/staff', data),
  registerPatient: (data) => request('POST', '/patients/register', data),
  loadDemo: () => request('POST', '/admin/load-demo'),
  notifications: () => request('GET', '/admin/notifications'),
  markNotificationRead: (id) => request('PUT', `/admin/notifications/${id}/read`),
  deletePatient: (id) => request('DELETE', `/admin/patients/${id}`),

  // Doctor
  doctorPatients: () => request('GET', '/doctor/patients'),
  orderTest: (data) => request('POST', '/doctor/order-test', data),
  markReady: (patientId) => request('PUT', `/doctor/mark-ready/${patientId}`),
  stayJustification: (data) => request('POST', '/doctor/stay-justification', data),
  referral: (data) => request('POST', '/doctor/referral', data),

  // Nurse
  nurseTasks: () => request('GET', '/nurse/tasks'),
  completeNurseTask: (taskId) => request('PUT', `/nurse/complete-discharge/${taskId}`),

  // Pharmacy
  pharmacyTasks: () => request('GET', '/pharmacy/tasks'),
  dispense: (data) => request('POST', '/pharmacy/dispense', data),
  confirmPharmacyTask: (taskId) => request('PUT', `/pharmacy/confirm-task/${taskId}`),

  // Billing
  billingPatients: () => request('GET', '/billing/patients'),
  getBill: (patientId) => request('GET', `/billing/bill/${patientId}`),
  editBillItem: (itemId, data) => request('PUT', `/billing/edit-item/${itemId}`, data),
  markPaid: (billId) => request('PUT', `/billing/mark-paid/${billId}`),
  insuranceCheck: (patientId) => request('GET', `/billing/insurance-check/${patientId}`),

  // Patient Portal
  patientPortal: () => request('GET', '/patient/portal'),
  fileDispute: (data) => request('POST', '/patient/dispute', data),
  submitExternalReport: (data) => request('POST', '/patient/submit-external-report', data),
  qrPortal: (token) => request('GET', `/patient/qr/${token}`),

  // Fraud
  fraudFlags: () => request('GET', '/fraud/flags'),
  fraudPatterns: () => request('GET', '/fraud/patterns'),
  resolveFlag: (id) => request('PUT', `/fraud/resolve/${id}`),
  runAnalysis: () => request('POST', '/fraud/run-analysis'),
}

export function setToken(token) {
  localStorage.setItem('sevaarth_token', token)
}
export function clearToken() {
  localStorage.removeItem('sevaarth_token')
}
