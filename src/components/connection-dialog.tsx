import type { PropsWithOverlays } from '@overlastic/react'
import type { AppConfig, DshConnection } from '@/hooks/use-app-config'
import { Button, Checkbox, Description, Input, Modal } from '@heroui/react'
import { useDisclosure } from '@overlastic/react'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { queryClient } from '@/config/client'
import { useAppConfig } from '@/hooks/use-app-config'

export interface ConnectionDialogProps extends PropsWithOverlays {}

/** 管理外部 Harness 连接与并行工作区的连接选择。 */
export function ConnectionDialog(props: ConnectionDialogProps) {
  const disclosure = useDisclosure({ props })
  const { t } = useTranslation()
  const { data: config } = useAppConfig()
  const connections = config?.connections ?? []
  const connectedConnectionIds = config?.connected_connection_ids ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingConnectionId, setUpdatingConnectionId] = useState<string | null>(null)

  function startNewConnection() {
    setEditingId(null)
    setName('')
    setUrl('')
    setError('')
  }

  function startEditingConnection(connection: DshConnection) {
    setEditingId(connection.id)
    setName(connection.name)
    setUrl(connection.url)
    setError('')
  }

  async function handleSave() {
    if (saving)
      return
    setSaving(true)
    setError('')
    try {
      const editingConnection = connections.find(connection => connection.id === editingId)
      if (!editingConnection || editingConnection.url !== url.trim()) {
        await invoke('probe_dsh_connection', { url })
      }
      const updatedConfig = editingId
        ? await invoke<AppConfig>('update_dsh_connection', { id: editingId, name, url })
        : await invoke<AppConfig>('add_dsh_connection', { name, url })
      queryClient.setQueryData(['config'], updatedConfig)
      disclosure.confirm()
    }
    catch (reason) {
      console.error('[ConnectionDialog] failed to save connection:', reason)
      setError(t('connections.save_failed'))
    }
    finally {
      setSaving(false)
    }
  }

  function toggleConnection(connection: DshConnection, connected: boolean) {
    setUpdatingConnectionId(connection.id)
    setError('')
    void invoke<AppConfig>('set_dsh_connection_connected', { id: connection.id, connected })
      .then((updatedConfig) => {
        queryClient.setQueryData(['config'], updatedConfig)
      })
      .catch((reason) => {
        console.error('[ConnectionDialog] failed to update connection selection:', reason)
        setError(t('connections.selection_failed'))
      })
      .finally(() => {
        setUpdatingConnectionId(null)
      })
  }

  return (
    <Modal isOpen={disclosure.visible} onOpenChange={disclosure.cancel}>
      <Modal.Backdrop>
        <Modal.Container size="xs">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('connections.manage_title')}</Modal.Heading>
              <Description>{t('connections.manage_description')}</Description>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <If
                cond={connections.length > 0}
                else={<Description>{t('connections.empty')}</Description>}
              >
                <div className="space-y-2">
                  {connections.map(connection => (
                    <div key={connection.id} className="flex items-center gap-2 rounded-medium border border-default-200 p-2">
                      <Checkbox
                        isSelected={connectedConnectionIds.includes(connection.id)}
                        isDisabled={saving || updatingConnectionId === connection.id}
                        aria-label={t('connections.connect')}
                        onChange={connected => toggleConnection(connection, connected)}
                        className="shrink-0"
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink">{connection.name}</div>
                        <div className="truncate text-xs text-default-500">{connection.url}</div>
                      </div>
                      <Button variant="tertiary" size="sm" onPress={() => startEditingConnection(connection)} isDisabled={saving || updatingConnectionId === connection.id}>
                        {t('connections.edit')}
                      </Button>
                    </div>
                  ))}
                </div>
              </If>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink">
                  {editingId ? t('connections.edit_title') : t('connections.add_title')}
                </span>
                <If cond={editingId !== null}>
                  <Button variant="tertiary" size="sm" onPress={startNewConnection} isDisabled={saving}>
                    {t('connections.new')}
                  </Button>
                </If>
              </div>
              <label className="flex flex-col gap-1 text-sm text-ink">
                <span>{t('connections.name')}</span>
                <Input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder={t('connections.name_placeholder')}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                <span>{t('connections.url')}</span>
                <Input
                  value={url}
                  onChange={event => setUrl(event.target.value)}
                  placeholder={t('connections.url_placeholder')}
                />
              </label>
              <Description>{t('connections.external_hint')}</Description>
              <If cond={Boolean(error)}>
                <Description className="text-danger">{error}</Description>
              </If>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={disclosure.cancel} isDisabled={saving}>
                {t('buttons.cancel')}
              </Button>
              <Button variant="primary" onPress={handleSave} isPending={saving}>
                {t('connections.save')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
