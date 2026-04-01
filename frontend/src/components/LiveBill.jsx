export default function LiveBill({ bill, fraudFlags, onDispute }) {
  if (!bill) return (
    <div className="card text-center py-8 text-gray-500">
      <span className="text-3xl block mb-2">📄</span>No bill generated yet
    </div>
  )

  const flaggedItemIds = new Set()
  fraudFlags?.forEach(f => {
    if (['overcharge', 'unbundling', 'duplicate', 'manipulation'].includes(f.flag_type)) {
      try { const ev = JSON.parse(f.evidence); if (ev.item_name) flaggedItemIds.add(ev.item_name) } catch {}
    }
  })

  const totalBenchmark = bill.items?.reduce((s, i) => s + (i.benchmark_price || 0), 0) || 0
  const varianceAmount = bill.total_amount - totalBenchmark
  const variancePct = totalBenchmark > 0 ? ((varianceAmount / totalBenchmark) * 100).toFixed(1) : 0

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">💰 Live Bill</h2>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">₹{bill.total_amount?.toLocaleString()}</p>
          <div className="flex items-center gap-2 justify-end text-xs mt-1">
            <span className="text-gray-500">Benchmark: ₹{totalBenchmark.toLocaleString()}</span>
            {varianceAmount > 0 && <span className="text-red-400">+₹{varianceAmount.toLocaleString()} ({variancePct}%)</span>}
          </div>
        </div>
      </div>

      {!bill.hash_valid && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2 mb-4 text-red-400 text-sm font-semibold">
          ⚠️ Bill integrity check FAILED — Hash mismatch detected. This bill may have been tampered with.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr>
            <th>Item</th><th>Plain Language</th><th>Ordered By</th><th>When</th>
            <th>Benchmark</th><th>Charged</th><th>Variance</th><th>Flag</th><th></th>
          </tr></thead>
          <tbody>
            {bill.items?.map(item => {
              const variance = item.benchmark_price ? item.total_price - item.benchmark_price : 0
              const isFlagged = item.variance_flag || item.duplicate_flag || flaggedItemIds.has(item.item_name)
              return (
                <tr key={item.id} className={isFlagged ? 'bg-red-500/5' : ''}>
                  <td className="text-white text-xs font-medium">{item.item_name}</td>
                  <td className="text-gray-400 text-xs">{item.plain_language_name}</td>
                  <td className="text-gray-500 text-xs">#{item.ordered_by}</td>
                  <td className="text-gray-500 text-[10px]">{item.ordered_at ? new Date(item.ordered_at).toLocaleDateString() : '—'}</td>
                  <td className="text-emerald-400 font-mono text-xs">₹{item.benchmark_price || '—'}</td>
                  <td className={`font-mono text-xs ${isFlagged ? 'text-red-400 font-bold' : 'text-white'}`}>₹{item.total_price?.toLocaleString()}</td>
                  <td className={`font-mono text-xs ${variance > 0 ? 'text-red-400' : 'text-gray-500'}`}>{variance > 0 ? `+₹${variance.toLocaleString()}` : '—'}</td>
                  <td>
                    {item.variance_flag ? <span className="text-red-400 text-xs" title="Above benchmark">⚠</span> : null}
                    {item.duplicate_flag ? <span className="text-amber-400 text-xs ml-1" title="Possible duplicate">◈</span> : null}
                  </td>
                  <td>
                    <button onClick={() => onDispute?.(item)} className="text-vheal-400 text-[10px] hover:underline">Dispute</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10">
              <td colSpan={5} className="text-white font-bold text-right">Total</td>
              <td className="text-white font-bold font-mono">₹{bill.total_amount?.toLocaleString()}</td>
              <td colSpan={3}><span className={`badge ${bill.payment_status === 'paid' ? 'badge-discharged' : 'badge-admitted'}`}>{bill.payment_status}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Bill Versions */}
      {bill.versions?.length > 1 && (
        <details className="mt-4">
          <summary className="text-sm text-vheal-400 cursor-pointer hover:text-vheal-300">📜 View Bill History ({bill.versions.length} versions)</summary>
          <div className="mt-2 space-y-1.5">
            {bill.versions.map(v => (
              <div key={v.id} className="bg-surface-700 rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                <span className="text-gray-400">v{v.version_number}</span>
                <span className="text-white font-mono">₹{v.total_amount?.toLocaleString()}</span>
                <span className="text-gray-500">{v.change_reason}</span>
                <span className="text-gray-600 font-mono">{v.content_hash?.slice(0, 10)}…</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
