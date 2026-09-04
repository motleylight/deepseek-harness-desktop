import type { SshRecord } from './types'
import { Button, Description, Input, Modal } from '@heroui/react'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useSsh } from './context'

export function SshEditor({ record, renameOnly, onClose }: { record?: SshRecord, renameOnly: boolean, onClose: () => void }) {
  const { request, t } = useSsh()
  const [name, setName] = useState(record?.name || '')
  const [host, setHost] = useState(record?.host || '')
  const [user, setUser] = useState(record?.user || '')
  const [port, setPort] = useState(record?.port ? String(record.port) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    try {
      await request('save', { id: record?.id, name, host, user, port })
      onClose()
    }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return (
    <Modal
      isOpen
      onOpenChange={() => {
        if (!busy)
          onClose()
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>{t(renameOnly ? 'ssh.rename' : record ? 'ssh.edit' : 'ssh.add')}</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-3">
              <label className="block space-y-1">
                <span>{t('ssh.name')}</span>
                <Input value={name} onChange={event => setName(event.target.value)} disabled={busy} autoFocus />
              </label>
              <If cond={!renameOnly}>
                <label className="block space-y-1">
                  <span>{t('ssh.host')}</span>
                  <Input value={host} onChange={event => setHost(event.target.value)} disabled={busy} />
                </label>
                <label className="block space-y-1">
                  <span>{t('ssh.user')}</span>
                  <Input value={user} onChange={event => setUser(event.target.value)} disabled={busy} />
                </label>
                <label className="block space-y-1">
                  <span>{t('ssh.port')}</span>
                  <Input value={port} onChange={event => setPort(event.target.value)} disabled={busy} inputMode="numeric" />
                </label>
                <Description>{t('ssh.auth')}</Description>
              </If>
              <If cond={Boolean(error)}><p role="alert" className="break-words text-sm text-danger">{error}</p></If>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose} isDisabled={busy}>{t('ssh.cancel')}</Button>
              <Button variant="primary" onPress={save} isPending={busy}>{t('ssh.save')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
