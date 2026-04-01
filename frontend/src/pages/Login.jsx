import { useState } from 'react'
import { api, setToken } from '../api/client'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const roleHints = [
    { email: 'admin@vheal.com', pass: 'Admin@123', role: 'Admin', color: 'text-purple-400' },
    { email: 'doctor@vheal.com', pass: 'Doctor@123', role: 'Doctor', color: 'text-blue-400' },
    { email: 'nurse@vheal.com', pass: 'Nurse@123', role: 'Nurse', color: 'text-green-400' },
    { email: 'pharmacy@vheal.com', pass: 'Pharmacy@123', role: 'Pharmacy', color: 'text-amber-400' },
    { email: 'billing@vheal.com', pass: 'Billing@123', role: 'Billing', color: 'text-orange-400' },
  ]

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.login(email, password)
      setToken(res.token)
      onLogin(res.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 flex">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-vheal-900/60 via-surface-900 to-surface-800" />
        <div className="absolute top-0 left-0 w-96 h-96 bg-vheal-600/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl translate-x-1/4 translate-y-1/4" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-vheal-600 flex items-center justify-center text-xl font-black">V</div>
            <span className="text-2xl font-black text-white tracking-tight">VHEAL</span>
          </div>
          <p className="text-vheal-300 text-sm font-medium">Patient Protection OS</p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-black text-white leading-tight mb-4">
              Hospital fraud<br />
              <span className="text-vheal-400">made impossible.</span>
            </h1>
            <p className="text-gray-400 text-lg leading-relaxed">
              Real-time billing transparency, ML-powered fraud detection, and patient rights enforcement — built into every workflow.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: '🔍', text: 'Every charge benchmarked against NPPA/CGHS rates' },
              { icon: '🤖', text: 'ML detects overcharge, kickbacks & sink tests' },
              { icon: '⚖️', text: 'Patient rights enforced at every step' },
              { icon: '🔒', text: 'SHA-256 immutable bill versioning' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xl">{f.icon}</span>
                <span className="text-gray-300 text-sm">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stat pills */}
        <div className="relative z-10 flex gap-4">
          {[
            { label: 'Fraud Types', value: '9' },
            { label: 'ML Models', value: '5' },
            { label: 'Live Updates', value: '15s' },
          ].map((s, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-center">
              <div className="text-2xl font-black text-vheal-300">{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-vheal-600 flex items-center justify-center text-lg font-black">V</div>
            <span className="text-xl font-black text-white">VHEAL</span>
          </div>

          <h2 className="text-3xl font-bold text-white mb-2">Welcome back</h2>
          <p className="text-gray-500 mb-8">Sign in to your protected dashboard</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label mb-1.5 block">Email address</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@vheal.com"
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="label mb-1.5 block">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                ⚠️ {error}
              </div>
            )}

            <button id="login-btn" type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Quick login hints */}
          <div className="mt-8">
            <p className="text-xs text-gray-600 mb-3 uppercase tracking-wide font-semibold">Quick Access (Demo)</p>
            <div className="grid grid-cols-1 gap-1.5">
              {roleHints.map((h, i) => (
                <button
                  key={i}
                  id={`quick-login-${h.role.toLowerCase()}`}
                  onClick={() => { setEmail(h.email); setPassword(h.pass) }}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-700/50 hover:bg-surface-700 border border-white/5 transition-all text-left"
                >
                  <span className={`text-xs font-semibold ${h.color}`}>{h.role}</span>
                  <span className="text-xs text-gray-600">{h.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
