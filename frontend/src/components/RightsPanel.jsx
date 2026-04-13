export default function RightsPanel({ rights, govtSchemes }) {
  return (
    <div className="card border-sevaarth-500/20">
      <h2 className="section-title">⚖️ Your Patient Rights</h2>

      {/* Contextual Rights */}
      {rights?.length > 0 && (
        <div className="space-y-2 mb-6">
          {rights.map((r, i) => (
            <div key={i} className="bg-surface-700 rounded-xl px-4 py-3 border border-white/5">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{r.icon || '⚖️'}</span>
                <div>
                  <h4 className="text-white font-semibold text-sm">{r.title}</h4>
                  <p className="text-gray-400 text-xs mt-1 leading-relaxed">{r.description}</p>
                  {r.law_reference && <p className="text-sevaarth-400 text-[10px] mt-1 font-mono">{r.law_reference}</p>}
                  {r.actionable && <p className="text-emerald-400 text-xs mt-1 font-semibold">✓ {r.action_text || 'You can exercise this right now'}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Government Schemes */}
      {govtSchemes?.length > 0 && (
        <div>
          <h3 className="font-semibold text-white mb-3 text-sm">🏛 Government Schemes You May Qualify For</h3>
          <div className="grid grid-cols-2 gap-3">
            {govtSchemes.map((scheme, i) => (
              <div key={i} className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3">
                <h4 className="text-emerald-400 font-semibold text-sm">{scheme.scheme_name}</h4>
                <p className="text-gray-400 text-xs mt-1">{scheme.description}</p>
                {scheme.coverage_amount && (
                  <p className="text-white font-mono text-sm mt-2">Coverage: ₹{scheme.coverage_amount?.toLocaleString()}</p>
                )}
                {scheme.eligibility_criteria && (
                  <p className="text-gray-500 text-[10px] mt-1">{scheme.eligibility_criteria}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Always-visible fundamental rights */}
      <details className="mt-6">
        <summary className="text-sm text-sevaarth-400 cursor-pointer hover:text-sevaarth-300">📖 Know Your Fundamental Patient Rights</summary>
        <div className="mt-3 space-y-2 text-xs text-gray-400">
          {[
            { emoji: '🏥', text: 'Right to emergency treatment without advance payment (Clinical Establishments Act)' },
            { emoji: '📋', text: 'Right to itemized bill with clear description of all charges' },
            { emoji: '💊', text: 'Right to know generic alternatives and their prices (NPPA)' },
            { emoji: '🧪', text: 'Right to use reports from any NABL-accredited lab' },
            { emoji: '🚫', text: 'Right to not be detained for non-payment of bill' },
            { emoji: '📊', text: 'Right to benchmark all charges against government rates (CGHS/NPPA)' },
            { emoji: '⚖️', text: 'Right to dispute any charge within 30 days' },
            { emoji: '🔒', text: 'Right to audit trail of all bill modifications' },
          ].map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <span>{r.emoji}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
