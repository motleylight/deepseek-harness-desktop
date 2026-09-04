/* eslint-disable react-refresh/only-export-components -- Plugin context is consumed by multiple bundled Desktop components. */
import type { PropsWithChildren } from 'react'
import type { SshRecord } from './types'
import { invoke } from '@tauri-apps/api/core'
import { createContext, use, useEffect, useState } from 'react'
import { If } from 'react-if-lite'
import en from '../locales/en-US.json'
import zh from '../locales/zh-CN.json'
import { SshEditor } from './editor'

interface Runtime {
  records: SshRecord[]
  error: string
  managementId: string
  setManagementId: (value: string) => void
  edit: (record?: SshRecord, renameOnly?: boolean) => void
  request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
  t: (key: string) => string
}
const Context = createContext<Runtime | null>(null)
export function useSsh() {
  const value = use(Context)
  if (!value)
    throw new Error('DSH_SSH_PROVIDER_MISSING')
  return value
}

export function SshProvider({ locale, children }: PropsWithChildren<{ locale: string }>) {
  const [records, setRecords] = useState<SshRecord[]>([])
  const [error, setError] = useState('')
  const [managementId, setManagementId] = useState('managed-local')
  const [editor, setEditor] = useState<{ record?: SshRecord, renameOnly: boolean } | null>(null)
  function t(key: string) {
    const strings: Record<string, string> = locale.startsWith('zh') ? zh : en
    return strings[key] || key
  }
  async function request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await invoke<T>('dsh_ssh_request', { method, params })
    }
    finally {
      const next = await invoke<SshRecord[]>('dsh_ssh_request', { method: 'list', params: {} }).catch(() => null)
      if (next)
        setRecords(next)
    }
  }
  useEffect(() => {
    let disposed = false
    let pending = false
    async function refresh() {
      if (pending)
        return
      pending = true
      try {
        const next = await invoke<SshRecord[]>('dsh_ssh_request', { method: 'list', params: {} })
        if (!disposed) {
          setRecords(next)
          setError('')
        }
      }
      catch (reason) {
        if (!disposed)
          setError(String(reason))
      }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 1500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])
  return (
    <Context value={{ records, error, managementId: records.some(item => item.id === managementId) ? managementId : 'managed-local', setManagementId, edit: (record, renameOnly = false) => setEditor({ record, renameOnly }), request, t }}>
      {children}
      <If cond={editor !== null}><SshEditor key={editor?.record?.id || 'new-ssh'} record={editor?.record} renameOnly={editor?.renameOnly || false} onClose={() => setEditor(null)} /></If>
    </Context>
  )
}
