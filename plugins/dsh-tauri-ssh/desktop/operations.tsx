import type { SshRecord } from './types'
import { Button, Checkbox, Description, Label, Modal } from '@heroui/react'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useSsh } from './context'

export function RemoteAction({ record, action, label, params = {}, onDone }: { record: SshRecord, action: string, label: string, params?: Record<string, unknown>, onDone?: () => void }) {
  const { request, t } = useSsh()
  const [confirming, setConfirming] = useState(false)
  const [adopt, setAdopt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const adoptionRequired = action === 'install' && Boolean(record.status?.existingData || record.status?.existingBin)
  async function run() {
    setBusy(true)
    setError('')
    try {
      if (action === 'stop')
        await request('enable', { id: record.id, enabled: false })
      await request('operation', { id: record.id, request: { action, ...params, adopt, confirm: true } })
      if (action === 'install' || action === 'start')
        await request('enable', { id: record.id, enabled: true })
      setConfirming(false)
      onDone?.()
    }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return (
    <>
      <Button size="sm" variant="tertiary" onPress={() => setConfirming(true)} isDisabled={Boolean(record.busy) || busy}>{label}</Button>
      <If cond={confirming}>
        <Modal
          isOpen
          onOpenChange={() => {
            if (!busy)
              setConfirming(false)
          }}
        >
          <Modal.Backdrop>
            <Modal.Container size="sm">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>
                    {record.name}
                    {' '}
                    ·
                    {' '}
                    {label}
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="space-y-3">
                  <Description>{t(action === 'restore' ? 'ssh.restore_notice' : 'ssh.mutation_notice')}</Description>
                  <If cond={adoptionRequired}>
                    <Checkbox isSelected={adopt} onChange={setAdopt}>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                      <Label>{t('ssh.adopt')}</Label>
                    </Checkbox>
                  </If>
                  <If cond={Boolean(error)}><p role="alert" className="break-words text-sm text-danger">{error}</p></If>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" onPress={() => setConfirming(false)} isDisabled={busy}>{t('ssh.cancel')}</Button>
                  <Button variant="primary" onPress={run} isPending={busy} isDisabled={adoptionRequired && !adopt}>{t('ssh.confirm')}</Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </If>
    </>
  )
}

export function SshActions({ record }: { record: SshRecord }) {
  const { request, t } = useSsh()
  const [error, setError] = useState('')
  async function inspect() {
    setError('')
    try {
      await request('operation', { id: record.id, request: { action: 'status' } })
    }
    catch (reason) { setError(String(reason)) }
  }
  return (
    <div className="space-y-2">
      <Description>
        {t(record.busy ? 'ssh.busy' : !record.status ? 'ssh.unknown' : !record.status.installed ? 'ssh.not_installed' : record.status.running ? 'ssh.running' : 'ssh.stopped')}
        {' '}
        {record.status?.version}
      </Description>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="tertiary" onPress={inspect} isDisabled={Boolean(record.busy)}>{t('ssh.check')}</Button>
        <If cond={Boolean(record.status) && !record.status?.installed}><RemoteAction record={record} action="install" label={t('ssh.install')} /></If>
        <If cond={Boolean(record.status?.installed)}>
          <If cond={Boolean(record.status?.running)} else={<RemoteAction record={record} action="start" label={t('ssh.start')} />}>
            <RemoteAction record={record} action="restart" label={t('ssh.restart')} />
            <RemoteAction record={record} action="stop" label={t('ssh.stop')} />
          </If>
        </If>
      </div>
      <Description>{t('ssh.lifecycle')}</Description>
      <If cond={Boolean(error || record.error || record.status?.failure)}><p role="alert" className="break-words text-xs text-danger">{error || record.error || record.status?.failure}</p></If>
      <If cond={record.logs.length > 0}>
        <details>
          <summary className="cursor-pointer text-xs text-muted">{t('ssh.logs')}</summary>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{record.logs.join('')}</pre>
        </details>
      </If>
    </div>
  )
}
