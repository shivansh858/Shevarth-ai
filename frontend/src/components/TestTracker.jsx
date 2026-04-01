export default function TestTracker({ tests, protocol }) {
  if (!tests || tests.length === 0) return (
    <div className="card text-center py-6 text-gray-500">
      <span className="text-2xl block mb-2">🧪</span>No tests ordered yet
    </div>
  )

  const statusColors = {
    ordered: 'text-blue-400',
    collected: 'text-amber-400',
    processing: 'text-purple-400',
    resulted: 'text-emerald-400',
    cancelled: 'text-red-400',
  }
  const statusIcons = {
    ordered: '🔵', collected: '🟡', processing: '🟣', resulted: '🟢', cancelled: '🔴'
  }

  const inProtocol = tests.filter(t => t.is_in_protocol)
  const outProtocol = tests.filter(t => !t.is_in_protocol)
  const sinkTests = tests.filter(t => t.sink_test_flag)

  return (
    <div className="card">
      <h2 className="section-title">🧪 Test Tracker</h2>

      {/* Protocol adherence indicator */}
      <div className="flex gap-4 mb-4">
        <div className="bg-surface-700 rounded-xl px-4 py-2 border border-white/5 text-center">
          <span className="text-emerald-400 text-lg font-bold">{inProtocol.length}</span>
          <span className="text-xs text-gray-500 block">In Protocol</span>
        </div>
        <div className="bg-surface-700 rounded-xl px-4 py-2 border border-white/5 text-center">
          <span className="text-amber-400 text-lg font-bold">{outProtocol.length}</span>
          <span className="text-xs text-gray-500 block">Outside Protocol</span>
        </div>
        {sinkTests.length > 0 && (
          <div className="bg-red-500/10 rounded-xl px-4 py-2 border border-red-500/30 text-center">
            <span className="text-red-400 text-lg font-bold">{sinkTests.length}</span>
            <span className="text-xs text-red-400 block">⚠ Sink Tests</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {tests.map(test => (
          <div key={test.id} className={`bg-surface-700 rounded-xl px-4 py-3 border ${test.sink_test_flag ? 'border-red-500/30 bg-red-500/5' : !test.is_in_protocol ? 'border-amber-500/20' : 'border-white/5'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span>{statusIcons[test.status] || '⬜'}</span>
                <div>
                  <span className="text-white font-medium text-sm">{test.test_name}</span>
                  {test.test_code && <span className="text-gray-500 text-xs ml-2">({test.test_code})</span>}
                  {test.sink_test_flag ? <span className="badge badge-critical text-[10px] ml-2">⚠ Sink Test</span> : null}
                  {!test.is_in_protocol && <span className="badge badge-medium text-[10px] ml-2">Outside Protocol</span>}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className={`${statusColors[test.status] || 'text-gray-500'} capitalize font-semibold`}>{test.status}</span>
                <div className="text-right">
                  <span className="text-gray-400">₹{test.billed_amount}</span>
                  {test.benchmark_amount > 0 && <span className="text-gray-600 block">Benchmark ₹{test.benchmark_amount}</span>}
                </div>
              </div>
            </div>
            {test.justification_text && (
              <p className="text-gray-500 text-xs mt-2 italic">Justification: "{test.justification_text}"</p>
            )}
            {test.result_summary && (
              <p className="text-gray-400 text-xs mt-1">Result: {test.result_summary}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
