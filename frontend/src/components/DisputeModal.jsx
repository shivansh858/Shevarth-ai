import { useState } from 'react'

export default function DisputeModal({ item, options, onClose, onSubmit }) {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({ description })
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-surface-800 border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">⚖️ File Dispute</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
        </div>

        {item && (
          <div className="bg-surface-700 rounded-xl px-4 py-3 mb-4 border border-white/5">
            <p className="text-white font-medium text-sm">{item.item_name || item.plain_language_name}</p>
            {item.total_price && <p className="text-gray-400 text-xs">Charged: ₹{item.total_price}</p>}
            {item.benchmark_price && <p className="text-emerald-400 text-xs">Benchmark: ₹{item.benchmark_price}</p>}
          </div>
        )}

        {/* Quick dispute options */}
        {options?.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-semibold">Quick Options</p>
            <div className="flex flex-wrap gap-1.5">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDescription(opt.description || opt)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:border-sevaarth-500/40 transition-all"
                >
                  {typeof opt === 'string' ? opt : opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <textarea
            className="input-field"
            rows={4}
            placeholder="Describe the issue with this charge..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
          />
          <div className="flex gap-3 mt-4">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={loading || !description.trim()} className="btn-primary flex-1">
              {loading ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Filing...</span> : '⚖️ File Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
