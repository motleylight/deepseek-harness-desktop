import type { DshConnection } from './types'
import { Button, Description, Label, Modal } from '@heroui/react'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

/** Deletes only the saved Desktop connection after confirmation. */
export function ConnectionDeleteDialog({ connection, onClose }: { connection: DshConnection, onClose: () => void }) {
  const { t, mutateConnection } = useConnectionHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    if (busy)
      return
    setBusy(true)
    try {
      await mutateConnection('remove_dsh_connection', { id: connection.id })
      onClose()
    }
    catch {
      setError(t('connections.action_failed'))
    }
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
        <Modal.Container size="xs">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>{t('connections.delete_title')}</Modal.Heading></Modal.Header>
            <Modal.Body>
              <Label>{connection.name}</Label>
              <Description>{t('connections.delete_confirm')}</Description>
              <If cond={Boolean(error)}><p role="alert" className="text-sm text-danger">{error}</p></If>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>{t('buttons.cancel')}</Button>
              <Button variant="danger" isPending={busy} onPress={remove}>{t('connections.delete')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
