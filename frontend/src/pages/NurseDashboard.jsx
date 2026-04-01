import { useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'

export default function NurseDashboard({ user }) {
  const fetchTasks = useCallback(() => api.nurseTasks(), [])
  const { data, loading, refetch, secondsAgo } = usePolling(fetchTasks)

  async function completeTask(taskId) {
    try { await api.completeNurseTask(taskId); refetch() } catch (e) { alert(e.message) }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <h1 className="text-xl font-bold text-white">Nurse Dashboard</h1>
        <p className="text-xs text-gray-500">{user.name} {secondsAgo !== null && <span className="text-emerald-400">· <span className="animate-pulse">●</span> Live · {secondsAgo}s ago</span>}</p>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <h2 className="section-title">📋 Discharge Clearance Tasks</h2>
          {loading && !data ? <Spinner /> : data?.discharge_tasks?.length === 0 ? (
            <div className="card text-center py-12 text-gray-500">✅ No pending discharge tasks</div>
          ) : (
            <div className="grid gap-3">
              {data?.discharge_tasks?.map(t => (
                <div key={t.id} className="card flex items-center justify-between animate-fade-in">
                  <div>
                    <p className="text-white font-semibold">{t.patient_name}</p>
                    <p className="text-gray-400 text-sm">{t.diagnosis} · Bed {t.bed_number} · {t.ward_type}</p>
                    <p className="text-xs text-gray-500 mt-1">Task: {t.task_type} · Created: {new Date(t.created_at).toLocaleString()}</p>
                  </div>
                  <button onClick={() => completeTask(t.id)} className="btn-success">✓ Complete Clinical Clearance</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="section-title">🏥 Active Patients</h2>
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Patient</th><th>Diagnosis</th><th>Ward</th><th>Bed</th><th>State</th><th>Doctor</th></tr></thead>
              <tbody>
                {data?.patients?.map(p => (
                  <tr key={p.id}>
                    <td className="text-white font-medium">{p.name}</td>
                    <td>{p.diagnosis}</td>
                    <td className="capitalize">{p.ward_type}</td>
                    <td>{p.bed_number || '—'}</td>
                    <td><StateBadge state={p.state} /></td>
                    <td className="text-gray-400">{p.doctor_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
function StateBadge({ state }) {
  const cls = { ADMITTED:'badge-admitted', READY_SOON:'badge-ready-soon', DISCHARGING:'badge-discharging', DISCHARGED:'badge-discharged' }
  return <span className={`badge ${cls[state] || 'badge-low'}`}>{state}</span>
}
function Spinner() { return <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-vheal-500/30 border-t-vheal-500 rounded-full animate-spin" /></div> }
