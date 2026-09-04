import { Button, Spinner } from '@heroui/react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

export function ConnectionLoading({ title, subtitle, errorMsg, onRetry }: { title?: string, subtitle?: string, errorMsg?: string, onRetry?: () => void, icon?: unknown }) {
  const { t } = useConnectionHost()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-ink">
      <If cond={!errorMsg}><Spinner /></If>
      <span>{title || subtitle}</span>
      <If cond={Boolean(errorMsg)}><p className="max-w-lg break-words text-sm text-danger">{errorMsg}</p></If>
      <If cond={Boolean(onRetry)}><Button onPress={onRetry}>{t('connections.retry')}</Button></If>
    </div>
  )
}
