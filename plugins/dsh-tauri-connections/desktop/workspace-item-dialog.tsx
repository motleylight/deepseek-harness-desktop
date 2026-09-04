import type { DshConnection } from './types'
import type { WorkspaceRequest } from './workspace-client'
import { Button, Input, Modal } from '@heroui/react'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

export interface WorkspaceItemAction {
  command: 'rename-workspace' | 'delete-workspace' | 'rename-session' | 'archive-workspace'
  connection: DshConnection
  id: string
  title: string
}

/** Edits one captured endpoint and id; changing the saved address invalidates the action. */
export function WorkspaceItemDialog({ action, available, request, onClose }: { action: WorkspaceItemAction, available: boolean, request: WorkspaceRequest, onClose: () => void }) {
  const { t } = useConnectionHost()
  const [title, setTitle] = useState(action.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleting = action.command === 'delete-workspace'
  const confirming = deleting || action.command === 'archive-workspace'
  async function submit() {
    if (busy || !available)
      return
    setBusy(true)
    setError('')
    try {
      if (action.command === 'rename-session')
        await request(action.connection.id, action.command, { sessionId: action.id, title })
      else if (action.command === 'rename-workspace')
        await request(action.connection.id, action.command, { workspaceId: action.id, title })
      else
        await request(action.connection.id, action.command, { workspaceId: action.id })
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
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header><Modal.Heading>{t(`workspace.${action.command}`)}</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-3">
              <p className="text-xs text-muted">
                {action.connection.name}
                {' '}
                ·
                {' '}
                {action.connection.displayUrl || action.connection.url}
              </p>
              <If
                cond={confirming}
                else={(
                  <Input
                    autoFocus
                    aria-label={t('connections.name')}
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    disabled={busy}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        void submit()
                    }}
                  />
                )}
              >
                <p className="text-sm">{t(deleting ? 'workspace.delete_description' : 'workspace.archive_description', { name: action.title })}</p>
              </If>
              <If cond={!available}><p role="alert" className="text-sm text-danger">{t('connections.missing')}</p></If>
              <If cond={Boolean(error)}><p role="alert" className="text-sm text-danger">{error}</p></If>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose} isDisabled={busy}>{t('buttons.cancel')}</Button>
              <Button variant={deleting ? 'danger' : 'primary'} onPress={submit} isPending={busy} isDisabled={!available || !title.trim()}>{t(confirming ? `workspace.${action.command}` : 'connections.save')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
