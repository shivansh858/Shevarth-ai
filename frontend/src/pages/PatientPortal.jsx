import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'
import LiveBill from '../components/LiveBill'
import TestTracker from '../components/TestTracker'
import RightsPanel from '../components/RightsPanel'
import DisputeModal from '../components/DisputeModal'

const STEPS = [
  { key: 'Nursing', label: 'Clinical Clearance', icon: '🩺' },
  { key: 'Pharmacy', label: 'Pharmacy', icon: '💊' },
  { key: 'Billing', label: 'Billing', icon: '💰' },
  { key: 'Housekeeping', label: 'Housekeeping', icon: '🧹' },
]

export default function PatientPortal({ user }) {
  const [showDispute, setShowDispute] = useState(null)
  const fetchPortal = useCallback(() => api.patientPortal(), [])
  const { data, loading, refetch, secondsAgo } = usePolling(fetchPortal)

  if (loading && !data) return <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-vheal-500/30 border-t-vheal-500 rounded-full animate-spin" /></div>
  if (!data) return <div className="flex-1 p-6"><div className="card text-center py-20 text-gray-500">Unable to load patient portal</div></div>

  const { patient, state_history, discharge_tasks, test_orders, medicines, bill, fraud_flags, disputes, rights, govt_schemes, dispute_options, notifications } = data

  const taskMap = {}
  discharge_tasks?.forEach(t => { taskMap[t.department] = t })

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{patient.name}</h1>
            <p className="text-sm text-gray-400">{patient.diagnosis} ({patient.diagnosis_code}) · Day {patient.current_day} · {patient.ward_type} Ward</p>
          </div>
          <div className="text-right">
            <span className={`badge text-sm px-4 py-1.5 badge-${patient.state === 'ADMITTED' ? 'admitted' : patient.state === 'DISCHARGING' ? 'discharging' : patient.state === 'DISCHARGED' ? 'discharged' : 'ready-soon'}`}>{patient.state}</span>
            {secondsAgo !== null && <p className="text-xs text-emerald-400 mt-1"><span className="animate-pulse">●</span> Live · {secondsAgo}s ago</p>}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Fraud Alerts Banner */}
        {fraud_flags?.filter(f => f.status === 'open').length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <h3 className="text-red-400 font-bold flex items-center gap-2"><span>🚨</span> Billing Issues Detected</h3>
            <div className="mt-3 space-y-2">
              {fraud_flags.filter(f => f.status === 'open').map(f => (
                <div key={f.id} className="flex items-start gap-3 text-sm">
                  <span className={`badge text-[10px] mt-0.5 badge-${f.severity}`}>{f.severity}</span>
                  <span className="text-gray-300">{f.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 1: Discharge Pipeline */}
        <div className="card">
          <h2 className="section-title">Discharge Progress</h2>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {STEPS.map((step, i) => {
              const task = taskMap[step.key]
              const completed = task?.status === 'complete'
              const active = task?.status === 'pending'
              return (
                <div key={step.key} className="flex items-center gap-2">
                  <div className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl min-w-[120px] border transition-all ${completed ? 'bg-emerald-500/10 border-emerald-500/30' : active ? 'bg-vheal-600/10 border-vheal-500/30 animate-pulse-slow' : 'bg-surface-700 border-white/5'}`}>
                    <span className="text-2xl">{completed ? '✅' : active ? step.icon : '⬜'}</span>
                    <span className={`text-xs font-semibold ${completed ? 'text-emerald-400' : active ? 'text-vheal-300' : 'text-gray-500'}`}>{step.label}</span>
                    {task?.completed_at && <span className="text-[10px] text-gray-500">{new Date(task.completed_at).toLocaleTimeString()}</span>}
                  </div>
                  {i < STEPS.length - 1 && <div className={`w-8 h-0.5 ${completed ? 'bg-emerald-500' : 'bg-surface-600'}`} />}
                </div>
              )
            })}
            <div className="w-8 h-0.5 bg-surface-600" />
            <div className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl min-w-[120px] border ${patient.state === 'DISCHARGED' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-surface-700 border-white/5'}`}>
              <span className="text-2xl">{patient.state === 'DISCHARGED' ? '🎉' : '🏥'}</span>
              <span className={`text-xs font-semibold ${patient.state === 'DISCHARGED' ? 'text-emerald-400' : 'text-gray-500'}`}>Discharged</span>
            </div>
          </div>
        </div>

        {/* Section 2: Live Bill */}
        <LiveBill bill={bill} fraudFlags={fraud_flags} onDispute={item => setShowDispute(item)} />

        {/* Section 3: Test Tracker */}
        <TestTracker tests={test_orders} protocol={data.protocol} />

        {/* Section 4: Medicines */}
        {medicines?.length > 0 && (
          <div className="card">
            <h2 className="section-title">💊 Medicines</h2>
            <div className="space-y-2">
              {medicines.map((m, i) => (
                <div key={i} className={`bg-surface-700 rounded-xl px-4 py-3 flex items-center justify-between ${m.overcharge_flag ? 'border border-red-500/30' : 'border border-white/5'}`}>
                  <div>
                    <span className="text-white font-medium text-sm">{m.name}</span>
                    <span className="text-gray-500 text-xs ml-2">× {m.quantity}</span>
                    {m.is_private_label ? <span className="badge badge-medium text-[10px] ml-2">Private Label</span> : null}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <span className="text-gray-500 text-xs">NPPA</span>
                      <span className="text-emerald-400 font-mono block">₹{m.nppa_ceiling_price || '—'}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500 text-xs">Charged</span>
                      <span className={`font-mono block ${m.overcharge_flag ? 'text-red-400' : 'text-white'}`}>₹{m.unit_price_charged}</span>
                    </div>
                    {m.overcharge_flag && (
                      <button onClick={() => setShowDispute({ item_name: m.name, id: null })} className="text-red-400 text-xs hover:underline">Dispute</button>
                    )}
                    {m.generic_alternative_name && (
                      <span className="text-blue-400 text-xs">Alt: {m.generic_alternative_name} (₹{m.generic_price})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 5: Rights Panel */}
        <RightsPanel rights={rights} govtSchemes={govt_schemes} />

        {/* Section 6: Disputes */}
        {disputes?.length > 0 && (
          <div className="card">
            <h2 className="section-title">⚖️ Your Disputes</h2>
            <div className="space-y-2">
              {disputes.map(d => (
                <div key={d.id} className="bg-surface-700 rounded-xl px-4 py-3 border border-white/5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-white font-medium text-sm">{d.item_name || d.plain_language_name || 'General Dispute'}</span>
                      <span className={`badge ml-2 text-[10px] ${d.status === 'resolved' ? 'badge-discharged' : d.status === 'open' ? 'badge-admitted' : 'badge-ready-soon'}`}>{d.status}</span>
                    </div>
                    {d.refund_amount > 0 && <span className="text-emerald-400 font-mono">Refund: ₹{d.refund_amount}</span>}
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{d.description}</p>
                  {d.resolution_note && <p className="text-gray-500 text-xs mt-1">Resolution: {d.resolution_note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 7: Notifications */}
        {notifications?.length > 0 && (
          <div className="card">
            <h2 className="section-title">🔔 Notifications</h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {notifications.slice(0, 20).map(n => (
                <div key={n.id} className={`flex items-start gap-3 px-3 py-2 rounded-xl ${n.is_read ? 'bg-surface-700/50' : 'bg-surface-700 border border-white/5'}`}>
                  <span className="text-lg">{n.type === 'fraud_alert' ? '🚨' : n.type === 'rights_info' ? '⚖️' : n.type === 'bill_update' ? '💰' : n.type === 'test_ordered' ? '🧪' : '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{n.title}</p>
                    <p className="text-gray-400 text-xs truncate">{n.message}</p>
                  </div>
                  <span className="text-gray-600 text-[10px] shrink-0">{new Date(n.created_at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dispute Modal */}
      {showDispute && (
        <DisputeModal
          item={showDispute}
          options={dispute_options}
          onClose={() => setShowDispute(null)}
          onSubmit={async (data) => {
            await api.fileDispute({ bill_item_id: showDispute.id, ...data })
            setShowDispute(null)
            refetch()
          }}
        />
      )}
    </div>
  )
}
