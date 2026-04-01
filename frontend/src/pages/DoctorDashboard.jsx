import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'

export default function DoctorDashboard({ user }) {
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [testForm, setTestForm] = useState({ test_name: '', test_code: '', justification: '' })
  const [testResult, setTestResult] = useState(null)
  const [justForm, setJustForm] = useState({ clinical_reason: '', expected_discharge: '' })
  const [refForm, setRefForm] = useState({ referred_to_name: '', referred_to_type: 'lab', clinical_justification: '' })

  const fetchPatients = useCallback(() => api.doctorPatients(), [])
  const { data: patients, loading, refetch, secondsAgo } = usePolling(fetchPatients)

  const commonTests = ['CBC', 'LFT', 'RFT', 'ECG', 'Chest X-Ray', 'Blood Culture', 'Urinalysis', 'Lipid Profile', 'HbA1c', 'Troponin I', 'CT Brain', 'Ultrasound Abdomen', 'Coagulation Profile', 'CRP', 'D-Dimer']

  async function orderTest(e) {
    e.preventDefault()
    if (!selectedPatient) return
    try {
      const res = await api.orderTest({ patient_id: selectedPatient.id, ...testForm })
      setTestResult(res)
      setTestForm({ test_name: '', test_code: '', justification: '' })
      refetch()
    } catch (err) { alert(err.message) }
  }

  async function markReady(patientId) {
    if (!confirm('Confirm discharge readiness? This will create tasks for all departments.')) return
    try {
      await api.markReady(patientId)
      refetch()
    } catch (err) { alert(err.message) }
  }

  async function fileJustification(e) {
    e.preventDefault()
    try {
      const res = await api.stayJustification({ patient_id: selectedPatient.id, ...justForm })
      alert(`Justification filed. Score: ${res.justification_score?.toFixed(2) || 'N/A'}`)
      refetch()
    } catch (err) { alert(err.message) }
  }

  async function createReferral(e) {
    e.preventDefault()
    try {
      const res = await api.referral({ patient_id: selectedPatient.id, ...refForm })
      alert(res.message)
      setRefForm({ referred_to_name: '', referred_to_type: 'lab', clinical_justification: '' })
    } catch (err) { alert(err.message) }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <h1 className="text-xl font-bold text-white">Doctor Dashboard</h1>
        <p className="text-xs text-gray-500">Dr. {user.name} · {secondsAgo !== null && <span className="text-emerald-400"><span className="animate-pulse">●</span> Live · {secondsAgo}s ago</span>}</p>
      </div>

      <div className="flex gap-6 p-6">
        {/* Patient List */}
        <div className="w-80 shrink-0 space-y-2">
          <h2 className="section-title text-base">My Patients ({patients?.length || 0})</h2>
          {loading && !patients ? (
            <div className="card py-8 text-center"><div className="w-6 h-6 border-2 border-vheal-500/30 border-t-vheal-500 rounded-full animate-spin mx-auto" /></div>
          ) : patients?.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No patients assigned.<br/><span className="text-xs">Load demo from Admin panel</span></div>
          ) : patients?.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPatient(p)}
              className={`w-full text-left card-sm transition-all ${selectedPatient?.id === p.id ? 'border-vheal-500/50 glow-blue' : 'hover:border-white/10'} ${p.state === 'DISCHARGING' ? 'pulse-border' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-white text-sm">{p.name}</span>
                <span className={`badge text-[10px] badge-${p.state === 'ADMITTED' ? 'admitted' : p.state === 'READY_SOON' ? 'ready-soon' : p.state === 'DISCHARGING' ? 'discharging' : 'discharged'}`}>{p.state}</span>
              </div>
              <p className="text-xs text-gray-400">{p.diagnosis} · Day {p.current_day}</p>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className="text-gray-500">Bed {p.bed_number || 'N/A'}</span>
                {p.overstay && <span className="text-amber-400">⚠ Overstay</span>}
                {p.fraud_flag_count > 0 && <span className="text-red-400">🚩{p.fraud_flag_count}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Patient Detail */}
        <div className="flex-1 space-y-6">
          {!selectedPatient ? (
            <div className="card text-center py-20 text-gray-500">
              <span className="text-4xl block mb-3">👈</span>
              Select a patient to view details
            </div>
          ) : (
            <>
              {/* Patient Header */}
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white">{selectedPatient.name}</h2>
                    <p className="text-gray-400 text-sm">{selectedPatient.diagnosis} ({selectedPatient.diagnosis_code}) · {selectedPatient.ward_type} · Bed {selectedPatient.bed_number || 'N/A'}</p>
                    <p className="text-gray-500 text-xs mt-1">Day {selectedPatient.current_day} of {selectedPatient.standard_stay_days || '?'} standard days</p>
                  </div>
                  {selectedPatient.state === 'ADMITTED' || selectedPatient.state === 'READY_SOON' ? (
                    <button onClick={() => markReady(selectedPatient.id)} className="btn-success">✓ Mark Ready for Discharge</button>
                  ) : (
                    <span className={`badge badge-${selectedPatient.state === 'DISCHARGING' ? 'discharging' : 'discharged'} text-sm px-4 py-1.5`}>{selectedPatient.state}</span>
                  )}
                </div>
                {selectedPatient.overstay && (
                  <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 text-amber-400 text-sm">
                    ⚠ Stay exceeds benchmark ({selectedPatient.standard_stay_days} days). File a justification below.
                  </div>
                )}
              </div>

              {/* Order Test */}
              <div className="card">
                <h3 className="font-semibold text-white mb-3">🧪 Order Test</h3>
                <form onSubmit={orderTest} className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {commonTests.map(t => (
                      <button type="button" key={t} onClick={() => setTestForm({...testForm, test_name: t})}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${testForm.test_name === t ? 'bg-vheal-600 border-vheal-500 text-white' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'}`}
                      >{t}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input className="input-field" placeholder="Test name" value={testForm.test_name} onChange={e => setTestForm({...testForm, test_name: e.target.value})} required />
                    <input className="input-field" placeholder="Test code (optional)" value={testForm.test_code} onChange={e => setTestForm({...testForm, test_code: e.target.value})} />
                  </div>
                  <textarea className="input-field" rows={2} placeholder="Justification (required if outside protocol)" value={testForm.justification} onChange={e => setTestForm({...testForm, justification: e.target.value})} />
                  <button type="submit" className="btn-primary">Order Test</button>
                </form>

                {testResult && (
                  <div className={`mt-3 rounded-xl px-4 py-3 text-sm animate-fade-in ${testResult.is_in_protocol ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                    <span className="font-semibold">{testResult.test_name}</span>
                    <span className={`ml-2 badge ${testResult.is_in_protocol ? 'badge-discharged' : 'badge-high'}`}>{testResult.is_in_protocol ? '✓ In Protocol' : '⚠ Outside Protocol'}</span>
                    {testResult.justification_score != null && (
                      <span className="ml-2 text-gray-400">NLP Score: <span className="text-vheal-300 font-mono">{testResult.justification_score.toFixed(2)}</span></span>
                    )}
                    <p className="text-gray-400 mt-1">Billed: ₹{testResult.billed_amount} · Benchmark: ₹{testResult.benchmark_amount}</p>
                  </div>
                )}
              </div>

              {/* Stay Justification (if overstay) */}
              {selectedPatient.overstay && (
                <div className="card border-amber-500/20">
                  <h3 className="font-semibold text-amber-400 mb-3">📋 Stay Justification Required</h3>
                  <form onSubmit={fileJustification} className="space-y-3">
                    <textarea className="input-field" rows={3} placeholder="Clinical reason for extended stay..." value={justForm.clinical_reason} onChange={e => setJustForm({...justForm, clinical_reason: e.target.value})} required />
                    <input type="date" className="input-field" value={justForm.expected_discharge} onChange={e => setJustForm({...justForm, expected_discharge: e.target.value})} />
                    <button type="submit" className="btn-primary">File Justification</button>
                  </form>
                </div>
              )}

              {/* Referral */}
              <div className="card">
                <h3 className="font-semibold text-white mb-3">🔗 Referral</h3>
                <form onSubmit={createReferral} className="grid grid-cols-3 gap-3">
                  <input className="input-field" placeholder="Referred to name" value={refForm.referred_to_name} onChange={e => setRefForm({...refForm, referred_to_name: e.target.value})} required />
                  <select className="input-field" value={refForm.referred_to_type} onChange={e => setRefForm({...refForm, referred_to_type: e.target.value})}>
                    <option value="lab">Lab</option><option value="specialist">Specialist</option><option value="imaging">Imaging</option>
                  </select>
                  <input className="input-field" placeholder="Clinical justification" value={refForm.clinical_justification} onChange={e => setRefForm({...refForm, clinical_justification: e.target.value})} />
                  <button type="submit" className="btn-primary col-span-3">Create Referral</button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
