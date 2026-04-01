import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { usePolling } from '../hooks/usePolling'

export default function BillingDashboard({ user }) {
  const [selectedPatientId, setSelectedPatientId] = useState(null)
  const [billData, setBillData] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [editPrice, setEditPrice] = useState('')

  const fetchPatients = useCallback(() => api.billingPatients(), [])
  const { data: patients, loading, refetch, secondsAgo } = usePolling(fetchPatients)

  async function viewBill(patientId) {
    setSelectedPatientId(patientId)
    try {
      const bill = await api.getBill(patientId)
      setBillData(bill)
    } catch (e) { alert(e.message) }
  }

  async function saveEdit(itemId) {
    try {
      await api.editBillItem(itemId, { unit_price: parseFloat(editPrice), reason: 'Manual correction' })
      setEditingItem(null)
      viewBill(selectedPatientId)
      refetch()
    } catch (e) { alert(e.message) }
  }

  async function markPaid(billId) {
    if (!confirm('Mark this bill as paid?')) return
    try {
      await api.markPaid(billId)
      viewBill(selectedPatientId)
      refetch()
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-white/5 px-6 py-4">
        <h1 className="text-xl font-bold text-white">💰 Billing Dashboard</h1>
        <p className="text-xs text-gray-500">{user.name} {secondsAgo !== null && <span className="text-emerald-400">· <span className="animate-pulse">●</span> Live</span>}</p>
      </div>
      <div className="flex gap-6 p-6">
        {/* Patient list */}
        <div className="w-72 shrink-0 space-y-2">
          <h2 className="section-title text-base">Patients</h2>
          {patients?.map(p => (
            <button key={p.id} onClick={() => viewBill(p.id)}
              className={`w-full text-left card-sm transition-all ${selectedPatientId === p.id ? 'border-vheal-500/50 glow-blue' : 'hover:border-white/10'}`}
            >
              <div className="flex justify-between items-center">
                <span className="text-white font-medium text-sm">{p.name}</span>
                <span className={`badge text-[10px] ${p.payment_status === 'paid' ? 'badge-discharged' : p.payment_status === 'disputed' ? 'badge-high' : 'badge-admitted'}`}>{p.payment_status || 'No Bill'}</span>
              </div>
              <p className="text-xs text-gray-500">{p.diagnosis}</p>
              {p.total_amount > 0 && <p className="text-sm font-mono text-vheal-300 mt-1">₹{p.total_amount?.toLocaleString()}</p>}
              {p.flagged_items > 0 && <span className="text-red-400 text-xs">🚩 {p.flagged_items} flagged</span>}
              {p.open_disputes > 0 && <span className="text-amber-400 text-xs ml-2">⚖ {p.open_disputes} disputes</span>}
            </button>
          ))}
        </div>

        {/* Bill Detail */}
        <div className="flex-1">
          {!billData ? (
            <div className="card text-center py-20 text-gray-500"><span className="text-4xl block mb-3">👈</span>Select a patient to view their bill</div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              {/* Bill Header */}
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white">Bill #{billData.id}</h2>
                    <p className="text-gray-400 text-sm">Version {billData.version} · {billData.items?.length || 0} items</p>
                    {!billData.hash_valid && <p className="text-red-400 text-xs mt-1">⚠️ HASH MISMATCH — Bill may have been tampered</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-white">₹{billData.total_amount?.toLocaleString()}</p>
                    <span className={`badge ${billData.payment_status === 'paid' ? 'badge-discharged' : 'badge-admitted'}`}>{billData.payment_status}</span>
                  </div>
                </div>
                {billData.payment_status === 'pending' && (
                  <button onClick={() => markPaid(billData.id)} className="btn-success w-full mt-4">💰 Mark as Paid</button>
                )}
              </div>

              {/* Bill Items */}
              <div className="card overflow-hidden p-0">
                <table className="data-table">
                  <thead><tr><th>Item</th><th>Plain Name</th><th>Qty</th><th>Unit Price</th><th>Total</th><th>Benchmark</th><th>Variance</th><th>Actions</th></tr></thead>
                  <tbody>
                    {billData.items?.map(item => (
                      <tr key={item.id} className={item.variance_flag ? 'bg-red-500/5' : item.duplicate_flag ? 'bg-amber-500/5' : ''}>
                        <td className="text-white font-medium text-xs">{item.item_name}</td>
                        <td className="text-gray-400 text-xs">{item.plain_language_name}</td>
                        <td className="font-mono">{item.quantity}</td>
                        <td className="font-mono">
                          {editingItem === item.id ? (
                            <input className="input-field py-1 px-2 w-24 text-xs" value={editPrice} onChange={e => setEditPrice(e.target.value)} autoFocus />
                          ) : <span>₹{item.unit_price}</span>}
                        </td>
                        <td className="font-mono text-white">₹{item.total_price?.toLocaleString()}</td>
                        <td className="font-mono text-emerald-400">₹{item.benchmark_price || '—'}</td>
                        <td>
                          {item.variance_flag ? <span className="badge badge-high text-[10px]">⚠ Over</span> : null}
                          {item.duplicate_flag ? <span className="badge badge-medium text-[10px] ml-1">Dup</span> : null}
                        </td>
                        <td>
                          {editingItem === item.id ? (
                            <div className="flex gap-1">
                              <button onClick={() => saveEdit(item.id)} className="text-emerald-400 text-xs hover:underline">Save</button>
                              <button onClick={() => setEditingItem(null)} className="text-gray-500 text-xs hover:underline">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingItem(item.id); setEditPrice(item.unit_price) }} className="text-vheal-400 text-xs hover:underline">Edit</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bill Versions */}
              {billData.versions?.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-white mb-3">📜 Bill History ({billData.versions.length} versions)</h3>
                  <div className="space-y-2">
                    {billData.versions.map(v => (
                      <div key={v.id} className="bg-surface-700 rounded-xl px-4 py-2 flex items-center justify-between text-sm">
                        <span className="text-gray-400">v{v.version_number}</span>
                        <span className="text-white font-mono">₹{v.total_amount?.toLocaleString()}</span>
                        <span className="text-gray-500 text-xs">{v.change_reason}</span>
                        <span className="text-gray-600 text-xs font-mono">{v.content_hash?.slice(0, 12)}...</span>
                        <span className="text-gray-500 text-xs">{new Date(v.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
