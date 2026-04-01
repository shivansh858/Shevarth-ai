import { useState, useEffect, useRef, useCallback } from 'react'

export function usePolling(fetchFn, intervalMs = 15000, enabled = true) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const intervalRef = useRef(null)
  const mountedRef = useRef(true)

  const fetch = useCallback(async () => {
    try {
      const result = await fetchFn()
      if (mountedRef.current) {
        setData(result)
        setError(null)
        setLastUpdated(new Date())
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [fetchFn])

  const startPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(fetch, intervalMs)
  }, [fetch, intervalMs])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    const handleVisibilityChange = () => {
      if (document.hidden) stopPolling()
      else { fetch(); startPolling() }
    }

    if (enabled) {
      fetch()
      startPolling()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      mountedRef.current = false
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, fetch, startPolling, stopPolling])

  const refetch = useCallback(() => {
    setLoading(true)
    fetch()
  }, [fetch])

  const secondsAgo = lastUpdated
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
    : null

  return { data, loading, error, refetch, lastUpdated, secondsAgo }
}
