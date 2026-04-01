import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'

export default function PharmacyDashboard({ user }) {
  const [selectedPatient, setSelectedPatient] = useState('')
  const [selectedMedicine, setSelectedMedicine] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [dispenseResult, setDispenseResult] = useState(null)

  const fetchData = useCallback(() => api.pharmacyTasks(), [])
  const { data, loading, refetch, secondsAgo } = usePolling(fetchData)

  async function handleDispense(e) {
    e.preventDefault()
    try {
      const res = await api.dispense({ patient_id: parseInt(selectedPatient), medicine_id: parseInt(selectedMedicine), quantity })
      setDispenseResult(res)
      refetch()
    } catch (err) { alert(err.message) }
  }

  async function confirmTask(taskId) {
    try { await api.confirmPharmacyTask(taskId); refetch() } catch (e) { alert(e.message) }
  }

  const medicines = data?.medicines || []
  const overchargedMeds = medicines.filter(m => m.nppa_ceiling_price && m.hospital_rate > m.nppa_ceiling_price * 1.1)
  const selMed = medicines.find(m => m.id === parseInt(selectedMedicine))

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <h1 className="text-xl font-bold text-white">💊 Pharmacy Dashboard</h1>
        <p className="text-xs text-gray-500">{user.name} {secondsAgo !== null && <span className="text-emerald-400">· <span className="animate-pulse">●</span> Live</span>}</p>
      </div>
      <div className="p-6 space-y-6">
        {/* Discharge Tasks */}
        {data?.discharge_tasks?.length > 0 && (
          <div>
            <h2 className="section-title">📋 Pending Discharge Tasks</h2>
            <div className="grid gap-3">
              {data.discharge_tasks.map(t => (
                <div key={t.id} className="card flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold">{t.patient_name}</p>
                    <p className="text-gray-400 text-sm">{t.diagnosis} · Bed {t.bed_number}</p>
                  </div>
                  <button onClick={() => confirmTask(t.id)} className="btn-success">✓ Confirm Reconciliation</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dispense Medicine */}
        <div className="card">
          <h2 className="font-semibold text-white mb-4">💊 Dispense Medicine</h2>
          <form onSubmit={handleDispense} className="grid grid-cols-4 gap-3">
            <select className="input-field" value={selectedPatient} onChange={e => setSelectedPatient(e.target.value)} required>
              <option value="">Select Patient</option>
              {data?.patients?.map(p => <option key={p.id} value={p.id}>{p.name} (Bed {p.bed_number})</option>)}
            </select>
            <select className="input-field" value={selectedMedicine} onChange={e => setSelectedMedicine(e.target.value)} required>
              <option value="">Select Medicine</option>
              {medicines.map(m => <option key={m.id} value={m.id}>{m.name} — ₹{m.hospital_rate}</option>)}
            </select>
            <input type="number" min={1} className="input-field" value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} />
            <button type="submit" className="btn-primary">Dispense</button>
          </form>

          {/* Price preview */}
          {selMed && (
            <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${selMed.hospital_rate > (selMed.nppa_ceiling_price || Infinity) * 1.1 ? 'bg-red-500/10 border border-red-500/30' : 'bg-surface-700 border border-white/5'}`}>
              <div className="flex items-center gap-4">
                <span className="text-white font-medium">{selMed.name}</span>
                {selMed.nppa_ceiling_price && (
                  <>
                    <span className="text-gray-400">NPPA: <span className="text-emerald-400 font-mono">₹{selMed.nppa_ceiling_price}</span></span>
                    <span className="text-gray-400">Hospital: <span className="text-white font-mono">₹{selMed.hospital_rate}</span></span>
                    {selMed.markup_percentage > 10 && <span className="text-red-400 font-semibold">⚠ {selMed.markup_percentage}% markup</span>}
                  </>
                )}
                {selMed.generic_alternative && <span className="text-blue-400 text-xs">Generic: {selMed.generic_alternative} (₹{selMed.generic_price})</span>}
              </div>
            </div>
          )}

          {/* Dispense result */}
          {dispenseResult && (
            <div className={`mt-3 rounded-xl px-4 py-3 text-sm animate-fade-in ${dispenseResult.overcharge ? 'bg-red-500/10 border border-red-500/30' : 'bg-emerald-500/10 border border-emerald-500/30'}`}>
              <p className="font-medium text-white">{dispenseResult.medicine} × {quantity}</p>
              <p className="text-gray-400">Charged: ₹{dispenseResult.charged} · NPPA: ₹{dispenseResult.nppa_total}</p>
              {dispenseResult.overcharge && <p className="text-red-400 font-semibold mt-1">⚠ OVERCHARGE: {dispenseResult.markup_pct}% above NPPA</p>}
              {dispenseResult.generic_available && <p className="text-blue-400 mt-1">Generic available: {dispenseResult.generic_name} (₹{dispenseResult.generic_price})</p>}
            </div>
          )}
        </div>

        {/* Overcharged Medicines Alert */}
        {overchargedMeds.length > 0 && (
          <div>
            <h2 className="section-title text-red-400">⚠ Overpriced Medicines ({overchargedMeds.length})</h2>
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Medicine</th><th>NPPA Ceiling</th><th>Hospital Rate</th><th>Markup %</th><th>Generic</th></tr></thead>
                <tbody>
                  {overchargedMeds.slice(0, 15).map(m => (
                    <tr key={m.id}>
                      <td className="text-white font-medium">{m.name}</td>
                      <td className="text-emerald-400 font-mono">₹{m.nppa_ceiling_price}</td>
                      <td className="text-red-400 font-mono">₹{m.hospital_rate}</td>
                      <td><span className="badge badge-high">{m.markup_percentage}%</span></td>
                      <td className="text-blue-400 text-xs">{m.generic_alternative || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
