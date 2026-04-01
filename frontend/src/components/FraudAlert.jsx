export default function FraudAlert({ flag, onResolve }) {
  const sevColors = {
    critical: { bg: 'bg-red-500/10', border: 'border-red-500/40', text: 'text-red-400', icon: '🔴' },
    high: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', icon: '🟠' },
    medium: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', icon: '🟡' },
    low: { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-400', icon: '⚪' },
  }
  const c = sevColors[flag.severity] || sevColors.low
  const typeLabels = {
    overcharge: '💰 Overcharge', sink_test: '🧪 Sink Test', kickback: '🔗 Kickback',
    extended_stay: '⏱ Extended Stay', unbundling: '📦 Unbundling', manipulation: '✏️ Bill Manipulation',
    emergency_violation: '🚨 Emergency Violation', wrongful_detention: '🔒 Wrongful Detention',
    external_report_violation: '📄 External Report Violation'
  }
  let evidence = null
  try { evidence = JSON.parse(flag.evidence) } catch {}

  return (
    <div className={`${c.bg} border ${c.border} rounded-2xl p-4 animate-slide-up ${flag.severity === 'critical' ? 'pulse-border' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-xl mt-0.5">{c.icon}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge badge-${flag.severity} text-xs`}>{flag.severity}</span>
              <span className={`${c.text} font-semibold text-sm`}>{typeLabels[flag.flag_type] || flag.flag_type}</span>
              {flag.patient_name && <span className="text-gray-500 text-xs">· Patient: <b className="text-gray-300">{flag.patient_name}</b></span>}
            </div>
            <p className="text-gray-300 text-sm mt-1.5">{flag.description}</p>
            {flag.flagged_staff && <p className="text-gray-500 text-xs mt-1">Flagged against: <b>{flag.flagged_staff}</b> ({flag.flagged_staff_role})</p>}
            {flag.ml_confidence_score > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-gray-500 text-xs">ML Confidence:</span>
                <div className="w-24 h-1.5 bg-surface-600 rounded-full">
                  <div className={`h-1.5 rounded-full ${flag.ml_confidence_score > 0.8 ? 'bg-red-500' : flag.ml_confidence_score > 0.5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${flag.ml_confidence_score * 100}%` }} />
                </div>
                <span className="text-gray-400 text-xs font-mono">{(flag.ml_confidence_score * 100).toFixed(0)}%</span>
                {flag.ml_model_used && <span className="text-gray-600 text-[10px]">({flag.ml_model_used})</span>}
              </div>
            )}
            {evidence && (
              <details className="mt-2">
                <summary className="text-[10px] text-gray-600 cursor-pointer hover:text-gray-400">View Evidence</summary>
                <pre className="text-[10px] text-gray-500 mt-1 bg-surface-800 rounded-lg p-2 overflow-x-auto">{JSON.stringify(evidence, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
        {flag.status === 'open' && onResolve && (
          <button onClick={onResolve} className="btn-ghost text-xs shrink-0 ml-3">✓ Resolve</button>
        )}
        {flag.status === 'resolved' && (
          <span className="badge badge-discharged text-xs">Resolved</span>
        )}
      </div>
    </div>
  )
}
