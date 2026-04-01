import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'
import BedGrid from '../components/BedGrid'
import FraudAlert from '../components/FraudAlert'

const STATE_COLORS = {
  ADMITTED: 'badge-admitted',
  READY_SOON: 'badge-ready-soon',
  READY: 'badge-ready-soon',
  DISCHARGING: 'badge-discharging',
  DISCHARGED: 'badge-discharged',
  BED_AVAILABLE: 'badge-bed-available',
}

export default function AdminDashboard({ user }) {
  const [activeTab, setActiveTab] = useState('bedgrid')
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoResult, setDemoResult] = useState(null)
  const [registeredCreds, setRegisteredCreds] = useState(null)
  const [form, setForm] = useState({
    name: '', age: '', gender: 'Male', phone: '', emergency_contact: '',
    diagnosis: '', diagnosis_code: '', ward_type: 'general', bed_number: '',
    doctor_id: '', insurance_provider: '', insurance_id: '', is_emergency: false
  })
  const [patientToDelete, setPatientToDelete] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchBedGrid = useCallback(() => api.bedGrid(), [])
  const fetchCompliance = useCallback(() => api.compliance(), [])
  const fetchStaff = useCallback(() => api.staff(), [])

  function handleDeletePatient(patient) {
    setPatientToDelete(patient);
  }

  async function confirmDelete() {
    if (!patientToDelete) return;
    setDeleteLoading(true);
    try {
      await api.deletePatient(patientToDelete.id);
      setPatientToDelete(null);
      fetchBedGrid(); // Trigger refetch
    } catch (e) {
      alert('Delete failed: ' + e.message);
    } finally {
      setDeleteLoading(false);
    }
  }

  const { data: bedGrid, loading: bgLoading, secondsAgo } = usePolling(fetchBedGrid, 15000, activeTab === 'bedgrid')
  const { data: compliance, loading: compLoading, refetch: refetchCompliance } = usePolling(fetchCompliance, 15000, activeTab === 'compliance')
  const { data: staffList } = usePolling(fetchStaff, 30000, activeTab === 'staff')

  const tabs = [
    { id: 'bedgrid', label: '🏥 Bed Grid' },
    { id: 'compliance', label: '🚨 Fraud Alerts' },
    { id: 'register', label: '➕ Register Patient' },
    { id: 'staff', label: '👥 Staff' },
  ]

  async function loadDemo() {
    setDemoLoading(true)
    try {
      const res = await api.loadDemo()
      setDemoResult(res)
    } catch (e) {
      alert('Demo load failed: ' + e.message)
    } finally {
      setDemoLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    try {
      const doctors = staffList?.filter(s => s.role === 'doctor') || []
      const payload = { ...form, age: parseInt(form.age), doctor_id: form.doctor_id ? parseInt(form.doctor_id) : doctors[0]?.id }
      const res = await api.registerPatient(payload)
      setRegisteredCreds(res)
      setForm({ name: '', age: '', gender: 'Male', phone: '', emergency_contact: '', diagnosis: '', diagnosis_code: '', ward_type: 'general', bed_number: '', doctor_id: '', insurance_provider: '', insurance_id: '', is_emergency: false })
    } catch (e) {
      alert('Registration failed: ' + e.message)
    }
  }

  const totalPatients = bedGrid
    ? (bedGrid.occupied?.length || 0) + (bedGrid.ready_soon?.length || 0) + (bedGrid.ready_for_discharge?.length || 0) + (bedGrid.discharged?.length || 0)
    : 0

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
            {secondsAgo !== null && (
              <p className="text-xs text-emerald-400 mt-0.5">
                <span className="animate-pulse">●</span> Live · Updated {secondsAgo}s ago
              </p>
            )}
          </div>
          <button
            id="load-demo-btn"
            onClick={loadDemo}
            disabled={demoLoading}
            className="btn-primary flex items-center gap-2"
          >
            {demoLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '⚡'}
            {demoLoading ? 'Loading...' : 'Load Demo Hospital'}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 mt-4">
          {[
            { label: 'Total Patients', value: totalPatients, color: 'text-blue-400' },
            { label: 'Occupied', value: bedGrid?.occupied?.length || 0, color: 'text-blue-400' },
            { label: 'Discharging', value: bedGrid?.ready_for_discharge?.length || 0, color: 'text-purple-400' },
            { label: 'Open Flags', value: compliance?.stats?.open_flags || 0, color: 'text-red-400' },
            { label: 'Critical', value: compliance?.stats?.critical_flags || 0, color: 'text-red-400' },
          ].map((s, i) => (
            <div key={i} className="bg-surface-800 rounded-xl px-4 py-2 text-center border border-white/5">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Demo result banner */}
      {demoResult && (
        <div className="mx-6 mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 animate-fade-in">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-emerald-400 font-semibold">{demoResult.message}</p>
              <p className="text-gray-400 text-sm mt-1">{demoResult.fraud_flags_created} fraud flags created • {demoResult.patients?.length} patients loaded</p>
            </div>
            <button onClick={() => setDemoResult(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          {demoResult.credentials && Object.keys(demoResult.credentials).length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {Object.entries(demoResult.credentials).map(([name, creds]) => (
                <div key={name} className="bg-surface-700 rounded-xl px-3 py-2 text-xs">
                  <span className="text-white font-medium">{name}</span>
                  <span className="text-gray-400 ml-2">{creds.email}</span>
                  <span className="text-emerald-400 ml-2 font-mono">{creds.password}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 mt-4">
        <div className="flex gap-1 bg-surface-800 p-1 rounded-2xl border border-white/5 w-fit">
          {tabs.map(t => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === t.id ? 'bg-vheal-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-4 animate-fade-in">
        {/* BED GRID */}
        {activeTab === 'bedgrid' && (
          bgLoading && !bedGrid ? <LoadingSpinner /> : <BedGrid data={bedGrid} onDeletePatient={handleDeletePatient} />
        )}

        {/* FRAUD / COMPLIANCE */}
        {activeTab === 'compliance' && (
          compLoading && !compliance ? <LoadingSpinner /> : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="section-title mb-0">Fraud Alerts</h2>
                <button onClick={refetchCompliance} className="btn-ghost text-sm">↻ Refresh</button>
              </div>
              {compliance?.fraud_flags?.length === 0 && (
                <div className="card text-center py-12 text-gray-500">✅ No open fraud flags</div>
              )}
              <div className="space-y-3">
                {compliance?.fraud_flags?.map(flag => (
                  <FraudAlert key={flag.id} flag={flag} onResolve={() => {
                    api.resolveFlag(flag.id).then(refetchCompliance)
                  }} />
                ))}
              </div>

              {/* Referral patterns */}
              {compliance?.referral_patterns?.length > 0 && (
                <div className="mt-6">
                  <h3 className="section-title">🔗 Suspicious Referral Patterns</h3>
                  <div className="card overflow-hidden">
                    <table className="data-table">
                      <thead><tr>
                        <th>Doctor</th><th>Lab / Specialist</th>
                        <th>Count (30d)</th><th>% of Referrals</th><th>Risk</th>
                      </tr></thead>
                      <tbody>
                        {compliance.referral_patterns.map(rp => (
                          <tr key={rp.id}>
                            <td className="text-white font-medium">{rp.doctor_name}</td>
                            <td>{rp.referred_to_name}</td>
                            <td className="font-mono">{rp.referral_count_30d}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-surface-600 rounded-full max-w-24">
                                  <div className="h-1.5 bg-red-500 rounded-full" style={{ width: `${Math.min(100, rp.referral_percentage)}%` }} />
                                </div>
                                <span className="text-red-400 font-mono text-xs">{rp.referral_percentage?.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td><span className={`badge ${rp.flagged ? 'badge-high' : 'badge-low'}`}>{rp.flagged ? 'Flagged' : 'Normal'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* REGISTER */}
        {activeTab === 'register' && (
          <div className="max-w-2xl">
            <h2 className="section-title">Register New Patient</h2>
            {registeredCreds && (
              <div className="mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 animate-fade-in">
                <p className="text-emerald-400 font-bold text-lg mb-3">✅ Patient Registered!</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">Login Email:</span><br/><span className="font-mono text-white">{registeredCreds.credentials?.email}</span></div>
                  <div><span className="text-gray-500">Password:</span><br/><span className="font-mono text-emerald-400 font-bold">{registeredCreds.credentials?.password}</span></div>
                  <div><span className="text-gray-500">Patient ID:</span><br/><span className="font-mono text-vheal-300">{registeredCreds.patient_id}</span></div>
                  <div><span className="text-gray-500">State:</span><br/><span className="badge badge-admitted">{registeredCreds.state}</span></div>
                </div>
                <p className="text-xs text-gray-500 mt-3">QR URL: <span className="font-mono">{registeredCreds.qr_url}</span></p>
                <button onClick={() => setRegisteredCreds(null)} className="mt-3 text-xs text-gray-500 hover:text-white">Dismiss →</button>
              </div>
            )}

            <form onSubmit={handleRegister} className="card space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label mb-1 block">Patient Name *</label><input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Full name" required /></div>
                <div><label className="label mb-1 block">Age *</label><input type="number" className="input-field" value={form.age} onChange={e => setForm({...form, age: e.target.value})} placeholder="Age" required /></div>
                <div><label className="label mb-1 block">Gender</label>
                  <select className="input-field" value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div><label className="label mb-1 block">Phone</label><input className="input-field" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="Phone number" /></div>
                <div><label className="label mb-1 block">Diagnosis *</label><input className="input-field" value={form.diagnosis} onChange={e => setForm({...form, diagnosis: e.target.value})} placeholder="e.g. Typhoid Fever" required /></div>
                <div><label className="label mb-1 block">Diagnosis Code *</label><input className="input-field" value={form.diagnosis_code} onChange={e => setForm({...form, diagnosis_code: e.target.value})} placeholder="e.g. A01.0" required /></div>
                <div><label className="label mb-1 block">Ward Type *</label>
                  <select className="input-field" value={form.ward_type} onChange={e => setForm({...form, ward_type: e.target.value})}>
                    <option value="general">General</option><option value="icu">ICU</option><option value="private">Private</option>
                  </select>
                </div>
                <div><label className="label mb-1 block">Bed Number</label><input className="input-field" value={form.bed_number} onChange={e => setForm({...form, bed_number: e.target.value})} placeholder="e.g. G-101" /></div>
                <div><label className="label mb-1 block">Insurance Provider</label><input className="input-field" value={form.insurance_provider} onChange={e => setForm({...form, insurance_provider: e.target.value})} placeholder="Star Health, etc." /></div>
                <div><label className="label mb-1 block">Insurance ID</label><input className="input-field" value={form.insurance_id} onChange={e => setForm({...form, insurance_id: e.target.value})} placeholder="Policy ID" /></div>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is-emergency" checked={form.is_emergency} onChange={e => setForm({...form, is_emergency: e.target.checked})} className="w-4 h-4 accent-red-500" />
                <label htmlFor="is-emergency" className="text-sm text-red-400 font-semibold">🚨 Emergency Admission</label>
              </div>
              <button type="submit" id="register-patient-btn" className="btn-primary w-full py-3">Register Patient & Generate Credentials</button>
            </form>
          </div>
        )}

        {/* STAFF */}
        {activeTab === 'staff' && (
          <div>
            <h2 className="section-title">Staff Accounts</h2>
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Last Login</th><th>Status</th></tr></thead>
                <tbody>
                  {staffList?.map(s => (
                    <tr key={s.id}>
                      <td className="text-white font-medium">{s.name}</td>
                      <td className="text-gray-400 font-mono text-xs">{s.email}</td>
                      <td><span className="badge badge-admitted capitalize">{s.role}</span></td>
                      <td className="text-gray-400">{s.department}</td>
                      <td className="text-gray-500 text-xs">{s.last_login ? new Date(s.last_login).toLocaleString() : 'Never'}</td>
                      <td><span className={`badge ${s.is_active ? 'badge-discharged' : 'badge-critical'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Custom Delete Confirmation Modal */}
      {patientToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-800 border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 border border-red-500/20">
                  ⚠️
                </div>
                <h3 className="text-xl font-bold text-white">Delete Patient</h3>
              </div>
              <p className="text-gray-400 text-sm mt-3">
                Are you sure you want to permanently delete <strong className="text-white font-medium">{patientToDelete.name}</strong> and all associated records? This action cannot be undone.
              </p>
            </div>
            <div className="p-4 bg-surface-900/50 flex gap-3 justify-end">
              <button 
                onClick={() => setPatientToDelete(null)}
                className="btn-ghost text-sm"
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="btn-danger text-sm flex items-center gap-2"
                disabled={deleteLoading}
              >
                {deleteLoading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {deleteLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-vheal-500/30 border-t-vheal-500 rounded-full animate-spin" />
    </div>
  )
}
