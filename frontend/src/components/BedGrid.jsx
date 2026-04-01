export default function BedGrid({ data, onDeletePatient }) {
  if (!data) return null

  const columns = [
    { key: 'occupied', label: 'Occupied', color: 'blue', icon: '🛏️', patients: data.occupied || [] },
    { key: 'ready_soon', label: 'Ready Soon', color: 'amber', icon: '⏰', patients: data.ready_soon || [] },
    { key: 'ready_for_discharge', label: 'Discharging', color: 'purple', icon: '🚪', patients: data.ready_for_discharge || [] },
    { key: 'discharged', label: 'Discharged', color: 'emerald', icon: '✅', patients: data.discharged || [] },
  ]

  const colorMap = {
    blue: { card: 'border-blue-500/30 bg-blue-500/5', badge: 'bg-blue-500/20 text-blue-400', count: 'text-blue-400' },
    amber: { card: 'border-amber-500/30 bg-amber-500/5', badge: 'bg-amber-500/20 text-amber-400', count: 'text-amber-400' },
    purple: { card: 'border-purple-500/30 bg-purple-500/5', badge: 'bg-purple-500/20 text-purple-400', count: 'text-purple-400' },
    emerald: { card: 'border-emerald-500/30 bg-emerald-500/5', badge: 'bg-emerald-500/20 text-emerald-400', count: 'text-emerald-400' },
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {columns.map(col => (
        <div key={col.key}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-400">{col.icon} {col.label}</h3>
            <span className={`text-lg font-bold ${colorMap[col.color].count}`}>{col.patients.length}</span>
          </div>
          <div className="space-y-2">
            {col.patients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-gray-600 text-xs">No patients</div>
            ) : col.patients.map(p => (
              <div key={p.id} className={`group rounded-xl border p-3 transition-all hover:scale-[1.02] relative ${colorMap[col.color].card} ${col.key === 'ready_for_discharge' && p.state === 'DISCHARGING' ? 'pulse-border' : ''}`}>
                <div className="flex items-center justify-between mb-1 pr-6">
                  <span className="text-white font-semibold text-sm truncate">{p.name}</span>
                  {p.fraud_count > 0 && <span className="text-red-400 text-xs shrink-0">🚩{p.fraud_count}</span>}
                </div>
                {onDeletePatient && (
                  <button 
                    onClick={() => onDeletePatient(p)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-500 transition-opacity p-1 rounded-md hover:bg-white/10"
                    title="Delete Patient"
                  >
                    🗑️
                  </button>
                )}
                <p className="text-gray-400 text-xs truncate">{p.diagnosis}</p>
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
                  <span>Bed {p.bed_number || '—'}</span>
                  <span>{p.hours_in_state}h</span>
                  <span className="truncate max-w-[80px] text-right">{p.doctor_name}</span>
                </div>
                {p.is_emergency ? <span className={`badge ${colorMap[col.color].badge} text-[10px] mt-1`}>🚨 Emergency</span> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
