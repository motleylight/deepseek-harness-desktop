import type { ConnectionsConfig, DshConnection } from './types'
import { Button, Description, Input, Modal } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

export type ConnectionEditorTarget = { kind: 'add' } | { kind: 'rename' | 'edit', connection: DshConnection }

/** Saves endpoint changes only after a successful probe; renaming also works offline. */
export function ConnectionEditor({ target, onClose }: { target: ConnectionEditorTarget, onClose: () => void }) {
  const { t, updateConfig } = useConnectionHost()
  const connection = target.kind === 'add' ? undefined : target.connection
  const [name, setName] = useState(connection?.name ?? '')
  const [url, setUrl] = useState(connection?.url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (saving)
      return
    if (!name.trim()) {
      setError(t('connections.name_required'))
      return
    }
    setSaving(true)
    setError('')
    try {
      if (target.kind === 'add' || (target.kind === 'edit' && connection?.url !== url.trim()))
        await invoke('probe_dsh_connection', { url })
      let result: ConnectionsConfig
      if (connection?.id === 'managed-local') {
        result = await invoke('rename_managed_dsh_connection', { name })
      }
      else if (connection) {
        result = await invoke('update_dsh_connection', { id: connection.id, name, url: target.kind === 'rename' ? connection.url : url })
      }
      else {
        result = await invoke('add_dsh_connection', { name, url })
      }
      updateConfig(result)
      onClose()
    }
    catch (reason) {
      console.error('[dsh-tauri-connections] save failed:', reason)
      setError(t('connections.save_failed'))
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onOpenChange={() => {
        if (!saving)
          onClose()
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="xs">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>{t(target.kind === 'add' ? 'connections.add_title' : target.kind === 'rename' ? 'connections.rename_title' : 'connections.edit_title')}</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-3">
              <label className="flex flex-col gap-1 text-sm text-ink">
                <span>{t('connections.name')}</span>
                <Input value={name} onChange={event => setName(event.target.value)} autoFocus disabled={saving} />
              </label>
              <If cond={target.kind !== 'rename'}>
                <label className="flex flex-col gap-1 text-sm text-ink">
                  <span>{t('connections.url')}</span>
                  <Input value={url} onChange={event => setUrl(event.target.value)} placeholder={t('connections.url_placeholder')} disabled={saving} />
                </label>
                <Description>{t('connections.edit_address_description')}</Description>
              </If>
              <If cond={Boolean(error)}><p role="alert" className="text-sm text-danger">{error}</p></If>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose} isDisabled={saving}>{t('buttons.cancel')}</Button>
              <Button variant="primary" onPress={save} isPending={saving}>{t('connections.save')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
