//! SSH 管理插件的桌面调用入口。
#[tauri::command]
pub async fn dsh_ssh_request(
    app_handle: tauri::AppHandle,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    crate::service::ssh_host::request(app_handle, method, params).await
}
