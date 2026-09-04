import type { PropsWithOverlays } from '@overlastic/react'
import type { AppConfig, DshConnection } from '@/hooks/use-app-config'
import { Button, Description, Input, Modal } from '@heroui/react'
import { useDisclosure } from '@overlastic/react'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { queryClient } from '@/config/client'
import { useAppConfig } from '@/hooks/use-app-config'
import { store } from '@/store'

export interface ConnectionDialogProps extends PropsWithOverlays {}

/** 管理外部 Harness 连接；保存后立即切换到更新后的连接。 */
export function ConnectionDialog(props: ConnectionDialogProps) {
  const disclosure = useDisclosure({ props })
  const { t } = useTranslation()
  const { data: config } = useAppConfig()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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
    let saved = false
    try {
      const updatedConfig = editingId
        ? await invoke<AppConfig>('update_dsh_connection', { id: editingId, name, url })
        : await invoke<AppConfig>('add_dsh_connection', { name, url })
      const connectionId = editingId ?? updatedConfig.connections.at(-1)?.id
      if (!connectionId)
        throw new Error('CONNECTION_SAVE_FAILED')
      saved = true
      setEditingId(connectionId)
      queryClient.setQueryData(['config'], updatedConfig)
      await store.harness.switchConnection(connectionId, true)
      disclosure.confirm()
    }
    catch (reason) {
      console.error('[ConnectionDialog] failed to save or connect:', reason)
      setError(t(saved ? 'connections.saved_but_unreachable' : 'connections.save_failed'))
    }
    finally {
      setSaving(false)
    }
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
              {config?.connections.length
                ? (
                    <div className="space-y-2">
                      {config.connections.map(connection => (
                        <div key={connection.id} className="flex items-center gap-2 rounded-medium border border-default-200 p-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-ink">{connection.name}</div>
                            <div className="truncate text-xs text-default-500">{connection.url}</div>
                          </div>
                          <Button variant="tertiary" size="sm" onPress={() => startEditingConnection(connection)} isDisabled={saving}>
                            {t('connections.edit')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )
                : <Description>{t('connections.empty')}</Description>}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink">
                  {editingId ? t('connections.edit_title') : t('connections.add_title')}
                </span>
                {editingId && (
                  <Button variant="tertiary" size="sm" onPress={startNewConnection} isDisabled={saving}>
                    {t('connections.new')}
                  </Button>
                )}
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
              {error && <Description className="text-danger">{error}</Description>}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={disclosure.cancel} isDisabled={saving}>
                {t('buttons.cancel')}
              </Button>
              <Button variant="primary" onPress={handleSave} isPending={saving}>
                {t('connections.save_and_connect')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
