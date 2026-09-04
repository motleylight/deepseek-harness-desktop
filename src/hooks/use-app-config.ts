import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'

/** 用户保存的外部 Harness 入口。Desktop 不管理该地址的服务进程。 */
export interface DshConnection {
  id: string
  name: string
  url: string
}

export interface AppConfig {
  installed: boolean
  port: number
  auto_start: boolean
  cli_link_enabled: boolean
  zoom_factor: number
  close_action: string
  auto_backup_enabled: boolean
  auto_backup_interval_days: number
  auto_backup_on_startup: boolean
  auto_backup_on_change: boolean
  backup_retention_count: number
  backup_include_credentials: boolean
  connections: DshConnection[]
  active_connection_id: string
}

/// 共享的 app 配置查询：config-close-action 与 config-debug 共用同一份
/// queryKey/queryFn 定义，避免两处手写 useQuery 漂移（如一方加了 staleTime）。
export function useAppConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => invoke<AppConfig>('get_app_config'),
  })
}
