import { useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'

export default function ComplianceDashboard({ user }) {
  const fetchPatterns = useCallback(() => api.fraudPatterns(), [])
  const fetchFlags = useCallback(() => api.fraudFlags(), [])
  const { data: patterns, loading } = usePolling(fetchPatterns, 30000)
  const { data: flags } = usePolling(fetchFlags, 15000)

  async function runAnalysis() {
    try { await api.runAnalysis(); alert('Analysis complete') } catch (e) { alert(e.message) }
  }

  const openFlags = flags?.filter(f => f.status === 'open') || []
  const byType = {}; openFlags.forEach(f => { byType[f.flag_type] = (byType[f.flag_type] || 0) + 1 })
  const bySeverity = {}; openFlags.forEach(f => { bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1 })

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-white">📊 Compliance Dashboard</h1>
          <p className="text-xs text-gray-500">ML Pattern Analysis & Fraud Overview</p>
        </div>
        <button onClick={runAnalysis} className="btn-primary">🤖 Run Full ML Analysis</button>
      </div>
      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: 'Open Flags', value: openFlags.length, color: 'text-red-400' },
            { label: 'Critical', value: bySeverity.critical || 0, color: 'text-red-500' },
            { label: 'High', value: bySeverity.high || 0, color: 'text-orange-400' },
            { label: 'Medium', value: bySeverity.medium || 0, color: 'text-amber-400' },
            { label: 'Low', value: bySeverity.low || 0, color: 'text-gray-400' },
          ].map((s, i) => (
            <div key={i} className="stat-card text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Fraud by Type */}
        <div className="card">
          <h2 className="section-title">Fraud Flags by Type</h2>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="bg-surface-700 rounded-xl px-4 py-3 flex justify-between items-center border border-white/5">
                <span className="text-gray-300 capitalize text-sm">{type.replace(/_/g, ' ')}</span>
                <span className="text-white font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Referral Patterns */}
        {patterns?.referral_patterns?.length > 0 && (
          <div className="card">
            <h2 className="section-title">🔗 Referral Pattern Clusters</h2>
            <div className="space-y-2">
              {patterns.referral_patterns.map((rp, i) => (
                <div key={i} className="bg-surface-700 rounded-xl px-4 py-3 border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{rp.doctor_name}</span>
                    <span className="text-gray-400">→ {rp.referred_to_name}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex-1 h-2 bg-surface-600 rounded-full">
                      <div className={`h-2 rounded-full ${rp.referral_percentage > 60 ? 'bg-red-500' : rp.referral_percentage > 40 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, rp.referral_percentage)}%` }} />
                    </div>
                    <span className="text-sm font-mono text-gray-300">{rp.referral_percentage?.toFixed(1)}%</span>
                    <span className="text-xs text-gray-500">{rp.referral_count_30d} refs</span>
                    {rp.anomaly_score && <span className="text-xs text-red-400">Score: {rp.anomaly_score}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Billing Anomalies */}
        {patterns?.billing_anomalies?.length > 0 && (
          <div className="card">
            <h2 className="section-title">📈 Billing vs Benchmark</h2>
            <div className="card overflow-hidden p-0">
              <table className="data-table">
                <thead><tr><th>Patient</th><th>Billed</th><th>Benchmark</th><th>Variance</th><th>Status</th></tr></thead>
                <tbody>
                  {patterns.billing_anomalies.map((ba, i) => (
                    <tr key={i}>
                      <td className="text-white font-medium">{ba.name}</td>
                      <td className="font-mono">₹{ba.total_amount?.toLocaleString()}</td>
                      <td className="font-mono text-emerald-400">₹{ba.benchmark_cost?.toLocaleString()}</td>
                      <td className={`font-mono ${ba.variance_pct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{ba.variance_pct > 0 ? '+' : ''}{ba.variance_pct}%</td>
                      <td><span className={`badge ${ba.over_benchmark ? 'badge-high' : 'badge-discharged'}`}>{ba.over_benchmark ? 'Over' : 'OK'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stay Analysis */}
        {patterns?.stay_analysis?.length > 0 && (
          <div className="card">
            <h2 className="section-title">⏱ Stay Duration Analysis</h2>
            <div className="grid grid-cols-2 gap-3">
              {patterns.stay_analysis.map((sa, i) => (
                <div key={i} className={`bg-surface-700 rounded-xl px-4 py-3 border ${sa.overstay ? 'border-amber-500/30' : 'border-white/5'}`}>
                  <div className="flex justify-between">
                    <span className="text-white font-medium text-sm">{sa.name}</span>
                    {sa.overstay && <span className="badge badge-medium text-[10px]">Overstay</span>}
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{sa.diagnosis}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Day <span className="text-white font-mono">{sa.current_day}</span></span>
                    <span>Standard: <span className="text-emerald-400 font-mono">{sa.standard_stay_days}d</span></span>
                    <span>Max: <span className="text-amber-400 font-mono">{sa.max_stay_days}d</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dispute Stats */}
        {patterns?.dispute_stats && (
          <div className="card">
            <h2 className="section-title">⚖ Dispute Resolution</h2>
            <div className="grid grid-cols-4 gap-4">
              <div className="stat-card text-center"><div className="text-2xl font-bold text-white">{patterns.dispute_stats.total_disputes || 0}</div><div className="label">Total</div></div>
              <div className="stat-card text-center"><div className="text-2xl font-bold text-emerald-400">{patterns.dispute_stats.resolved || 0}</div><div className="label">Resolved</div></div>
              <div className="stat-card text-center"><div className="text-2xl font-bold text-amber-400">{patterns.dispute_stats.open_disputes || 0}</div><div className="label">Open</div></div>
              <div className="stat-card text-center"><div className="text-2xl font-bold text-sevaarth-300">₹{(patterns.dispute_stats.total_refunds || 0).toLocaleString()}</div><div className="label">Total Refunds</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
