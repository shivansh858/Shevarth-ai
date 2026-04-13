import { useState, useEffect } from 'react'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import DoctorDashboard from './pages/DoctorDashboard'
import NurseDashboard from './pages/NurseDashboard'
import PharmacyDashboard from './pages/PharmacyDashboard'
import BillingDashboard from './pages/BillingDashboard'
import PatientPortal from './pages/PatientPortal'
import ComplianceDashboard from './pages/ComplianceDashboard'
import { api, clearToken } from './api/client'

const ROLE_PAGES = {
  admin: [
    { id: 'admin', label: 'Bed Grid & Patients', icon: '🏥' },
    { id: 'compliance', label: 'Compliance', icon: '📊' },
  ],
  doctor: [
    { id: 'doctor', label: 'My Patients', icon: '👨‍⚕️' },
  ],
  nurse: [
    { id: 'nurse', label: 'Discharge Tasks', icon: '🩺' },
  ],
  pharmacy: [
    { id: 'pharmacy', label: 'Pharmacy', icon: '💊' },
  ],
  billing: [
    { id: 'billing', label: 'Billing', icon: '💰' },
  ],
  patient: [
    { id: 'patient', label: 'My Portal', icon: '🏥' },
  ],
}

export default function App() {
  const [user, setUser] = useState(null)
  const [activePage, setActivePage] = useState(null)
  const [loading, setLoading] = useState(true)

  // Check existing session
  useEffect(() => {
    const token = localStorage.getItem('sevaarth_token')
    if (token) {
      api.me()
        .then(u => { setUser(u); setActivePage(getDefaultPage(u.role)) })
        .catch(() => { clearToken() })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  function getDefaultPage(role) {
    const pages = ROLE_PAGES[role]
    return pages?.[0]?.id || 'admin'
  }

  function handleLogin(userData) {
    setUser(userData)
    setActivePage(getDefaultPage(userData.role))
  }

  function handleLogout() {
    clearToken()
    setUser(null)
    setActivePage(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-sevaarth-500/30 border-t-sevaarth-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading SEVAARTH...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Login onLogin={handleLogin} />

  const pages = ROLE_PAGES[user.role] || []

  function renderPage() {
    switch (activePage) {
      case 'admin': return <AdminDashboard user={user} />
      case 'compliance': return <ComplianceDashboard user={user} />
      case 'doctor': return <DoctorDashboard user={user} />
      case 'nurse': return <NurseDashboard user={user} />
      case 'pharmacy': return <PharmacyDashboard user={user} />
      case 'billing': return <BillingDashboard user={user} />
      case 'patient': return <PatientPortal user={user} />
      default: return <AdminDashboard user={user} />
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface-800 border-r border-white/5 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sevaarth-600 flex items-center justify-center text-lg font-black text-white">S</div>
            <div>
              <span className="text-lg font-black text-white tracking-tight block leading-5">Sevaarth AI</span>
              <span className="text-[10px] text-sevaarth-400 font-medium">Patient Protection OS</span>
            </div>
          </div>
        </div>

        {/* User Info */}
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-white font-semibold text-sm truncate">{user.name}</p>
          <p className="text-gray-500 text-xs truncate">{user.email}</p>
          <span className="badge badge-admitted capitalize mt-1.5 text-[10px]">{user.role}</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {pages.map(page => (
            <button
              key={page.id}
              id={`nav-${page.id}`}
              onClick={() => setActivePage(page.id)}
              className={`sidebar-link w-full ${activePage === page.id ? 'active' : ''}`}
            >
              <span className="text-lg">{page.icon}</span>
              <span>{page.label}</span>
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/5">
          <button
            id="logout-btn"
            onClick={handleLogout}
            className="sidebar-link w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <span className="text-lg">🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderPage()}
      </main>
    </div>
  )
}
