use super::constants::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::StoreExt;

/// 桌面端自行启动并管理的本地 Harness 连接 id。
pub const MANAGED_CONNECTION_ID: &str = "managed-local";

/// 用户保存的外部 Harness 入口。
///
/// 外部连接只决定嵌入页面与可达性探测，不授予桌面端进程管理或原生桥接权限。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DshConnection {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Setting {
    pub installed: bool,
    pub port: u16,
    pub auto_start: bool,
    pub language: String,
    #[serde(default)]
    pub dsh_pkg_commit: Option<String>,
    /// 已安装 Harness 发行版对应的 GitHub release tag（与 dsh_pkg_commit 配套，
    /// 用于甄别“记录滞后于文件”与“同版本热修”两种不一致）
    #[serde(default)]
    pub dsh_pkg_tag: Option<String>,
    /// 命令行集成开关：安装后在用户 PATH 中注册 `dsh` 命令
    #[serde(default = "default_cli_link_enabled")]
    pub cli_link_enabled: bool,
    /// 预装插件引导是否已完成（确认安装或跳过都算完成，之后不再弹出）
    #[serde(default)]
    pub preinstall_done: bool,
    /// 上次引导结束时的 `preset-plugins.json` 内容指纹。资源文件每次安装都会被
    /// 强制覆盖、旧文件不复存在，只能把「上次看到的内容」记在这里，每次启动再比对：
    /// 内容有变更 → 重新进入预设引导。`None` = 老用户升级（无基线）→ 弹一次建立基线。
    #[serde(default)]
    pub preset_hash: Option<String>,
    /// 旧版 AppData `data/dsh` → 官方 `$DSH_HOME`（~/.dsh）数据迁移是否已完成。
    /// 幂等标记：迁移成功并删除旧目录后置位，避免重复合并。
    #[serde(default)]
    pub dsh_home_migrated: bool,
    /// 当前使用的档案 id（`$DSH_HOME/profiles/<id>`，默认 web）。
    /// 桌面端启动服务与插件管理都以它为准（见 service::profile）。
    #[serde(default = "default_active_profile")]
    pub active_profile: String,
    /// 活动核心的显式选择：`Some("local")` = 用户 CLI 安装的本地核心，
    /// `Some("app")` = 桌面端预打包核心；`None` = 自动（本地核心存在时优先）。
    #[serde(default)]
    pub active_core: Option<String>,
    /// 用户手动设置的服务端口（设置页「端口」输入，见 bridge::config）。
    /// 自动避让递增（配置端口被占 → 逐级顶高，见 workflow::launch）后，启动时
    /// 该端口空闲则回落回用户选择的值；`None` = 从未手动设置，回落目标为默认
    /// 端口（3080/3081）。避免端口只增不减、一路从 3080 漂到 3084+（issue #91）。
    #[serde(default)]
    pub manual_port: Option<u16>,
    /// 桌面主 WebView 的缩放比例。旧配置缺失时回落到 100%，读取与写入时均会
    /// 归一化到受支持的 50%–200% 范围和 10% 步长。
    #[serde(default = "default_zoom_factor")]
    pub zoom_factor: f64,
    /// 点击窗口关闭按钮时的行为：`tray` = 隐藏到托盘继续驻留，`quit` = 直接退出应用。
    /// 只接受 `tray` / `quit` 两个字面量，读取与写入时均归一化，未知值回落 `tray`；
    /// 字段刻意用 `String` 而非 enum——任一字段反序列化失败会让整个 `Setting` 回落
    /// 默认，严格 enum 的一个意外值会连带清空端口/语言/档案等全部设置。
    #[serde(default = "default_close_action")]
    pub close_action: String,
    /// 是否启用自动备份。
    #[serde(default)]
    pub auto_backup_enabled: bool,
    /// 自动备份间隔（天）。
    #[serde(default = "default_auto_backup_interval_days")]
    pub auto_backup_interval_days: u32,
    /// 是否在每次启动时自动备份。
    #[serde(default)]
    pub auto_backup_on_startup: bool,
    /// 是否在配置变化时自动备份。
    #[serde(default)]
    pub auto_backup_on_change: bool,
    /// 最多保留备份份数。
    #[serde(default = "default_backup_retention_count")]
    pub backup_retention_count: u32,
    /// 备份是否包含凭据文件（`.credentials.yaml`）。
    #[serde(default)]
    pub backup_include_credentials: bool,
    /// 用户保存的外部 Harness 连接。缺失时保持空列表，兼容既有 store。
    #[serde(default)]
    pub connections: Vec<DshConnection>,
    /// 已连接并展示在 Desktop 工作区树中的外部 Harness id。
    #[serde(default)]
    pub connected_connection_ids: Vec<String>,
    /// 标记多连接选择已从旧版单连接选择迁移完成。
    #[serde(default)]
    pub connection_selection_initialized: bool,
    /// 当前可见的工作区；内置托管实例恒为 `managed-local`。
    #[serde(default = "default_active_connection_id")]
    pub active_connection_id: String,
    /// 外部连接 id 的本地递增序号，避免把地址或凭据用作持久化 id。
    #[serde(default = "default_next_connection_id")]
    pub next_connection_id: u32,
}

pub const ZOOM_FACTOR_MIN: f64 = 0.5;
pub const ZOOM_FACTOR_MAX: f64 = 2.0;
pub const ZOOM_FACTOR_STEP: f64 = 0.1;

/// 默认档案：桌面端内置的 web 档案
fn default_active_profile() -> String {
    "web".to_string()
}

/// 默认显示桌面端托管的本地 Harness。
fn default_active_connection_id() -> String {
    MANAGED_CONNECTION_ID.to_string()
}

/// 首个外部连接的递增序号。
fn default_next_connection_id() -> u32 {
    1
}

/// 命令行集成默认开启（开发者工具场景，安装完成即可用）
fn default_cli_link_enabled() -> bool {
    true
}

/// 界面默认缩放为 100%。
pub fn default_zoom_factor() -> f64 {
    1.0
}

/// 默认关闭行为：隐藏到托盘继续驻留（D-09）。
pub fn default_close_action() -> String {
    "tray".to_string()
}

/// 自动备份默认间隔：7 天。
pub fn default_auto_backup_interval_days() -> u32 {
    7
}

/// 默认保留备份份数：10 份。
pub fn default_backup_retention_count() -> u32 {
    10
}

/// 把外部或旧存储中的关闭行为收敛到白名单，未知值一律回落到默认行为。
///
/// 只做精确匹配：不做 `trim()`、不做大小写折叠——store 可被手工编辑、旧版本或其它
/// 平台写入，宽松匹配会让 `"quit "` / `"TRAY"` 这类值以非预期形态进入下游判断。
pub fn normalize_close_action(value: &str) -> String {
    match value {
        "tray" | "quit" => value.to_string(),
        _ => default_close_action(),
    }
}

/// 将外部或旧存储中的缩放值限制到桌面端支持的稳定步长。
pub fn normalize_zoom_factor(value: f64) -> f64 {
    if !value.is_finite() {
        return default_zoom_factor();
    }
    let clamped = value.clamp(ZOOM_FACTOR_MIN, ZOOM_FACTOR_MAX);
    let steps_per_unit = 1.0 / ZOOM_FACTOR_STEP;
    (clamped * steps_per_unit).round() / steps_per_unit
}

/// 归一化自动备份设置：把间隔和保留份数限制在有效范围内。
///
/// - `interval_days` 限制在 [1, 90]，未知/越界回落默认 7。
/// - `retention_count` 限制在 [1, 50]，未知/越界回落默认 10。
pub fn normalize_backup_settings(interval_days: u32, retention_count: u32) -> (u32, u32) {
    let interval = if interval_days == 0 || interval_days > 90 {
        default_auto_backup_interval_days()
    } else {
        interval_days
    };
    let retention = if retention_count == 0 || retention_count > 50 {
        default_backup_retention_count()
    } else {
        retention_count
    };
    (interval, retention)
}

/// 归一化用户填写的 Harness HTTP(S) 地址。
///
/// 未填写协议时按 HTTP 处理，便于直接输入 `127.0.0.1:3080`。允许反向代理使用的
/// 路径，但不接受嵌入式凭据、查询参数或片段；前两类常含凭据，片段不会参与服务请求
/// 且会让嵌入页与探测目标不一致。
pub fn normalize_dsh_connection_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    let value = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };
    let parsed = reqwest::Url::parse(&value)
        .map_err(|_| "CONNECTION_URL_INVALID: enter a valid HTTP(S) URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "CONNECTION_URL_INVALID: enter an HTTP(S) address without credentials, query parameters, or a fragment"
                .to_string(),
        );
    }
    Ok(parsed.to_string())
}

/// 归一化外部连接名称，避免空白或超长标签挤占常驻导航栏。
fn normalize_dsh_connection_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(
            "CONNECTION_NAME_INVALID: enter a name between 1 and 80 characters".to_string(),
        );
    }
    Ok(name.to_string())
}

/// 清除损坏、重复或过期的连接记录，并归一化工作区的可见与连接选择。
fn normalize_connections(setting: &mut Setting) {
    let mut seen_ids = HashSet::new();
    let mut seen_urls = HashSet::new();
    setting.connections.retain_mut(|connection| {
        let Ok(url) = normalize_dsh_connection_url(&connection.url) else {
            return false;
        };
        let Ok(name) = normalize_dsh_connection_name(&connection.name) else {
            return false;
        };
        if connection.id.is_empty()
            || connection.id == MANAGED_CONNECTION_ID
            || !seen_ids.insert(connection.id.clone())
            || !seen_urls.insert(url.clone())
        {
            return false;
        }
        connection.url = url;
        connection.name = name;
        true
    });
    if !setting.connection_selection_initialized {
        if setting.active_connection_id != MANAGED_CONNECTION_ID
            && setting
                .connections
                .iter()
                .any(|connection| connection.id == setting.active_connection_id)
        {
            setting
                .connected_connection_ids
                .push(setting.active_connection_id.clone());
        }
        setting.connection_selection_initialized = true;
    }

    let valid_ids = setting
        .connections
        .iter()
        .map(|connection| connection.id.as_str())
        .collect::<HashSet<_>>();
    let mut selected_ids = HashSet::new();
    setting.connected_connection_ids.retain(|id| {
        valid_ids.contains(id.as_str()) && selected_ids.insert(id.clone())
    });

    if setting.active_connection_id != MANAGED_CONNECTION_ID
        && !setting
            .connected_connection_ids
            .iter()
            .any(|id| id == &setting.active_connection_id)
    {
        setting.active_connection_id = default_active_connection_id();
    }
    if setting.next_connection_id == 0 {
        setting.next_connection_id = default_next_connection_id();
    }
}

/// 把 Setting 的备份字段归一化到有效范围。
fn normalize_backup_fields(setting: &mut Setting) {
    let (interval, retention) = normalize_backup_settings(
        setting.auto_backup_interval_days,
        setting.backup_retention_count,
    );
    setting.auto_backup_interval_days = interval;
    setting.backup_retention_count = retention;
}

/// 默认服务端口：debug 构建与生产隔离，避免开发时与已运行的桌面端争用 3080。
pub fn default_port() -> u16 {
    if cfg!(debug_assertions) {
        DSH_DEV_PORT
    } else {
        DSH_PORT
    }
}

impl Default for Setting {
    fn default() -> Self {
        Self {
            installed: false,
            port: default_port(),
            auto_start: true,
            language: "zh-CN".to_string(),
            dsh_pkg_commit: None,
            dsh_pkg_tag: None,
            cli_link_enabled: default_cli_link_enabled(),
            preinstall_done: false,
            preset_hash: None,
            dsh_home_migrated: false,
            active_profile: default_active_profile(),
            active_core: None,
            manual_port: None,
            zoom_factor: default_zoom_factor(),
            close_action: default_close_action(),
            auto_backup_enabled: false,
            auto_backup_interval_days: default_auto_backup_interval_days(),
            auto_backup_on_startup: false,
            auto_backup_on_change: false,
            backup_retention_count: default_backup_retention_count(),
            backup_include_credentials: false,
            connections: Vec::new(),
            connected_connection_ids: Vec::new(),
            connection_selection_initialized: true,
            active_connection_id: default_active_connection_id(),
            next_connection_id: default_next_connection_id(),
        }
    }
}

/// Store 持久化文件名：debug 构建与生产隔离（各自独立文件）。
///
/// store（端口、installed、active_core 等）属于「应用数据」而非共用核心——
/// 生产默认 3080、开发默认 3081，共用一份 store 会让两边端口一路漂移
/// （release 读到开发写入的 3081 后把 3080 让出，开发下次又从 3081 漂走）
/// 并相互污染安装/核心等状态。
fn store_dat_file_name() -> &'static str {
    if cfg!(debug_assertions) {
        STORE_DAT_DEV_FILE
    } else {
        STORE_DAT_FILE
    }
}

fn setting_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_store_dat_setting<R: Runtime>(app_handle: &AppHandle<R>) -> Setting {
    let store = app_handle
        .store(store_dat_file_name())
        .expect("Failed to load store");
    let raw = store.get(STORE_SETTING_KEY);
    let value = raw.as_ref().and_then(|v| {
        v.as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .or_else(|| Some(v.clone()))
    });
    let mut setting = value
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(Setting::default);
    setting.zoom_factor = normalize_zoom_factor(setting.zoom_factor);
    setting.close_action = normalize_close_action(&setting.close_action);
    normalize_backup_fields(&mut setting);
    normalize_connections(&mut setting);
    setting
}

fn write_store_dat_setting(app_handle: &AppHandle, setting: &Setting) -> serde_json::Value {
    let store = app_handle
        .store(store_dat_file_name())
        .expect("Failed to load store");
    let value = serde_json::to_value(setting).unwrap();
    store.set(STORE_SETTING_KEY, value.clone());
    store.save().expect("Failed to save store");
    value
}

fn emit_setting(app_handle: &AppHandle, value: &serde_json::Value) {
    app_handle
        .emit("setting_updated", value)
        .expect("Failed to emit event");
}

fn preserve_persisted_fields(mut replacement: Setting, current: &Setting) -> Setting {
    replacement.zoom_factor = normalize_zoom_factor(current.zoom_factor);
    replacement.close_action = normalize_close_action(&current.close_action);
    replacement.connections = current.connections.clone();
    replacement.connected_connection_ids = current.connected_connection_ids.clone();
    replacement.connection_selection_initialized = current.connection_selection_initialized;
    replacement.active_connection_id = current.active_connection_id.clone();
    replacement.next_connection_id = current.next_connection_id;
    replacement
}

/// 兼容旧调用方的整对象写入，但始终保留锁内读到的最新缩放与关窗动作，避免
/// 长流程用陈旧 `Setting` 覆盖刚刚由快捷键 / 设置界面写入的值（丢更新）。
pub fn set_store_dat_setting(app_handle: &AppHandle, mut setting: Setting) {
    let value = {
        let _guard = setting_write_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let current = read_store_dat_setting(app_handle);
        setting = preserve_persisted_fields(setting, &current);
        normalize_backup_fields(&mut setting);
        normalize_connections(&mut setting);
        write_store_dat_setting(app_handle, &setting)
    };
    emit_setting(app_handle, &value);
}

/// 在一个短临界区内读取、修改并写回设置，避免多个精确字段更新彼此丢失。
pub fn update_store_dat_setting<F>(app_handle: &AppHandle, update: F) -> Setting
where
    F: FnOnce(&mut Setting),
{
    let (setting, value) = {
        let _guard = setting_write_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut setting = read_store_dat_setting(app_handle);
        update(&mut setting);
        setting.zoom_factor = normalize_zoom_factor(setting.zoom_factor);
        // 落盘前的第二道闸：调用方（含前端 invoke）写入的不可信取值不以原始形态进 store
        setting.close_action = normalize_close_action(&setting.close_action);
        normalize_backup_fields(&mut setting);
        normalize_connections(&mut setting);
        let value = write_store_dat_setting(app_handle, &setting);
        (setting, value)
    };
    emit_setting(app_handle, &value);
    setting
}

pub fn set_store_dat_zoom_factor(app_handle: &AppHandle, zoom_factor: f64) -> Setting {
    update_store_dat_setting(app_handle, |setting| {
        setting.zoom_factor = zoom_factor;
    })
}

/// 泛型 `Runtime`：允许从非 Wry 具体化的窗口句柄（如工具函数的
/// `WebviewWindow<R>`）读取设置；具体类型调用方不受影响。
pub fn get_store_dat_setting<R: Runtime>(app_handle: &AppHandle<R>) -> Setting {
    let _guard = setting_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    read_store_dat_setting(app_handle)
}

/// 添加一个外部 Harness 连接并返回更新后的设置。
pub fn add_dsh_connection(
    app_handle: &AppHandle,
    name: String,
    url: String,
) -> Result<Setting, String> {
    let name = normalize_dsh_connection_name(&name)?;
    let url = normalize_dsh_connection_url(&url)?;
    let existing = get_store_dat_setting(app_handle);
    if existing
        .connections
        .iter()
        .any(|connection| connection.url == url)
    {
        return Err("CONNECTION_URL_DUPLICATE: this address is already saved".to_string());
    }
    Ok(update_store_dat_setting(app_handle, |setting| {
        let mut next = setting.next_connection_id;
        let id = loop {
            let id = format!("external-{next}");
            next = next.saturating_add(1).max(1);
            if !setting
                .connections
                .iter()
                .any(|connection| connection.id == id)
            {
                break id;
            }
        };
        setting.next_connection_id = next;
        setting.connections.push(DshConnection {
            id: id.clone(),
            name,
            url,
        });
        setting.connected_connection_ids.push(id.clone());
        setting.active_connection_id = id;
    }))
}

/// 更新一个已保存的外部 Harness 连接并返回更新后的设置。
pub fn update_dsh_connection(
    app_handle: &AppHandle,
    id: String,
    name: String,
    url: String,
) -> Result<Setting, String> {
    let name = normalize_dsh_connection_name(&name)?;
    let url = normalize_dsh_connection_url(&url)?;
    let existing = get_store_dat_setting(app_handle);
    if !existing
        .connections
        .iter()
        .any(|connection| connection.id == id)
    {
        return Err("CONNECTION_NOT_FOUND: the selected connection no longer exists".to_string());
    }
    if existing
        .connections
        .iter()
        .any(|connection| connection.id != id && connection.url == url)
    {
        return Err("CONNECTION_URL_DUPLICATE: this address is already saved".to_string());
    }
    let updated = update_store_dat_setting(app_handle, |setting| {
        if let Some(connection) = setting
            .connections
            .iter_mut()
            .find(|connection| connection.id == id)
        {
            connection.name = name;
            connection.url = url;
        }
    });
    if !updated
        .connections
        .iter()
        .any(|connection| connection.id == id)
    {
        return Err("CONNECTION_NOT_FOUND: the selected connection no longer exists".to_string());
    }
    Ok(updated)
}

/// 设置一个外部 Harness 是否作为并行工作区保持连接。
pub fn set_dsh_connection_connected(
    app_handle: &AppHandle,
    id: String,
    connected: bool,
) -> Result<Setting, String> {
    let existing = get_store_dat_setting(app_handle);
    if !existing
        .connections
        .iter()
        .any(|connection| connection.id == id)
    {
        return Err("CONNECTION_NOT_FOUND: the selected connection no longer exists".to_string());
    }
    Ok(update_store_dat_setting(app_handle, |setting| {
        if connected {
            if !setting.connected_connection_ids.iter().any(|item| item == &id) {
                setting.connected_connection_ids.push(id);
            }
        } else {
            setting.connected_connection_ids.retain(|item| item != &id);
            if setting.active_connection_id == id {
                setting.active_connection_id = default_active_connection_id();
            }
        }
    }))
}

/// 选择当前可见的工作区；仅接受托管实例或已连接的外部 Harness。
pub fn select_dsh_connection(app_handle: &AppHandle, id: String) -> Result<Setting, String> {
    let existing = get_store_dat_setting(app_handle);
    if id != MANAGED_CONNECTION_ID
        && !existing
            .connected_connection_ids
            .iter()
            .any(|connection_id| connection_id == &id)
    {
        return Err("CONNECTION_NOT_CONNECTED: the selected connection is not connected".to_string());
    }
    Ok(update_store_dat_setting(app_handle, |setting| {
        setting.active_connection_id = id;
    }))
}

/// 删除外部连接；正在显示的条目删除后回退到托管实例。
pub fn remove_dsh_connection(app_handle: &AppHandle, id: String) -> Result<Setting, String> {
    let existing = get_store_dat_setting(app_handle);
    if !existing
        .connections
        .iter()
        .any(|connection| connection.id == id)
    {
        return Err("CONNECTION_NOT_FOUND: the selected connection no longer exists".to_string());
    }
    Ok(update_store_dat_setting(app_handle, |setting| {
        setting.connections.retain(|connection| connection.id != id);
        setting.connected_connection_ids.retain(|connection_id| connection_id != &id);
        if setting.active_connection_id == id {
            setting.active_connection_id = default_active_connection_id();
        }
    }))
}

/// 已安装 Harness 发行版对应的 GitHub release commit hash
pub fn get_dsh_pkg_commit(app_handle: &AppHandle) -> Option<String> {
    get_store_dat_setting(app_handle).dsh_pkg_commit
}

/// 记录已安装 Harness 发行版的 GitHub release commit hash
pub fn set_dsh_pkg_commit(app_handle: &AppHandle, commit: String) {
    let mut setting = get_store_dat_setting(app_handle);
    setting.dsh_pkg_commit = Some(commit);
    set_store_dat_setting(app_handle, setting);
}

/// 已安装 Harness 发行版对应的 GitHub release tag
pub fn get_dsh_pkg_tag(app_handle: &AppHandle) -> Option<String> {
    get_store_dat_setting(app_handle).dsh_pkg_tag
}

/// 记录已安装 Harness 发行版的 GitHub release tag
pub fn set_dsh_pkg_tag(app_handle: &AppHandle, tag: String) {
    let mut setting = get_store_dat_setting(app_handle);
    setting.dsh_pkg_tag = Some(tag);
    set_store_dat_setting(app_handle, setting);
}

#[cfg(test)]
mod tests {
    use super::{
        default_close_action, default_zoom_factor, normalize_close_action,
        normalize_connections, normalize_dsh_connection_url, normalize_zoom_factor,
        preserve_persisted_fields,
        DshConnection, Setting, MANAGED_CONNECTION_ID, ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN,
    };

    #[test]
    fn zoom_factor_defaults_for_legacy_settings() {
        let setting: Setting = serde_json::from_value(serde_json::json!({
            "installed": true,
            "port": 3080,
            "auto_start": true,
            "language": "en-US"
        }))
        .expect("legacy setting should deserialize");

        assert_eq!(setting.zoom_factor, default_zoom_factor());
    }

    #[test]
    fn zoom_factor_is_clamped_and_rounded() {
        assert_eq!(normalize_zoom_factor(0.1), ZOOM_FACTOR_MIN);
        assert_eq!(normalize_zoom_factor(3.0), ZOOM_FACTOR_MAX);
        assert!((normalize_zoom_factor(1.14) - 1.1).abs() < f64::EPSILON);
        let canonical = normalize_zoom_factor(1.16);
        assert_eq!(canonical, 1.2);
        assert_eq!(serde_json::to_string(&canonical).unwrap(), "1.2");
    }

    #[test]
    fn invalid_zoom_factor_resets_to_default() {
        assert_eq!(normalize_zoom_factor(f64::NAN), default_zoom_factor());
        assert_eq!(normalize_zoom_factor(f64::INFINITY), default_zoom_factor());
    }

    #[test]
    fn legacy_full_setting_write_preserves_latest_fields() {
        let mut stale = Setting::default();
        stale.zoom_factor = 0.8;
        stale.close_action = "quit".to_string();

        let mut current = Setting::default();
        current.zoom_factor = 1.6;
        current.close_action = "tray".to_string();

        let merged = preserve_persisted_fields(stale, &current);

        assert_eq!(merged.zoom_factor, 1.6);
        assert_eq!(
            merged.close_action, "tray",
            "整对象写入不得用陈旧值覆盖锁内读到的最新关窗动作"
        );
    }

    #[test]
    fn close_action_defaults_for_legacy_settings() {
        let setting: Setting = serde_json::from_value(serde_json::json!({
            "installed": true,
            "port": 4099,
            "auto_start": true,
            "language": "en-US"
        }))
        .expect("legacy setting should deserialize");

        assert_eq!(
            setting.close_action,
            default_close_action(),
            "旧配置缺失 close_action 时应回落默认"
        );
        assert_eq!(setting.port, 4099, "缺失 close_action 不应影响其余字段");
    }

    #[test]
    fn close_action_normalizes_unknown_values() {
        assert_eq!(normalize_close_action("tray"), "tray");
        assert_eq!(normalize_close_action("quit"), "quit");

        for raw in ["", "TRAY", "bogus", "quit ", "tray;drop"] {
            assert_eq!(
                normalize_close_action(raw),
                "tray",
                "非法值 {raw} 应回落默认"
            );
        }

        let setting: Setting = serde_json::from_value(serde_json::json!({
            "installed": true,
            "port": 4099,
            "auto_start": true,
            "language": "en-US",
            "close_action": "bogus"
        }))
        .expect("tampered setting should deserialize");

        assert_eq!(
            normalize_close_action(&setting.close_action),
            "tray",
            "store 中的非法值应在读取路径被归一化"
        );
        assert_eq!(
            setting.port, 4099,
            "非法 close_action 不得触发 Setting 整体回落默认"
        );
    }

    #[test]
    fn close_action_default_is_tray() {
        assert_eq!(
            default_close_action(),
            "tray",
            "新用户默认关闭行为为隐藏到托盘"
        );
        assert_eq!(Setting::default().close_action, "tray");
    }

    #[test]
    fn close_action_round_trip() {
        let setting = Setting {
            close_action: "quit".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&setting).expect("setting should serialize");
        let restored: Setting = serde_json::from_str(&json).expect("setting should deserialize");

        assert_eq!(
            normalize_close_action(&restored.close_action),
            "quit",
            "写入 store 再读回后关闭行为应保持不变"
        );
    }

    #[test]
    fn connection_url_accepts_http_and_https_addresses() {
        assert_eq!(
            normalize_dsh_connection_url("https://dsh.example.com:8443").unwrap(),
            "https://dsh.example.com:8443/"
        );
        assert_eq!(
            normalize_dsh_connection_url("http://127.0.0.1:3081/").unwrap(),
            "http://127.0.0.1:3081/"
        );
        assert_eq!(
            normalize_dsh_connection_url("127.0.0.1:3081").unwrap(),
            "http://127.0.0.1:3081/"
        );
        assert_eq!(
            normalize_dsh_connection_url("https://dsh.example.com/harness").unwrap(),
            "https://dsh.example.com/harness"
        );
    }

    #[test]
    fn connection_url_rejects_non_http_addresses_and_credentials() {
        for invalid in [
            "file:///C:/dsh",
            "https://user:token@dsh.example.com",
            "https://dsh.example.com/?token=secret",
            "https://dsh.example.com/#section",
            "not a URL",
        ] {
            assert!(
                normalize_dsh_connection_url(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn persisted_connection_fields_survive_legacy_full_setting_write() {
        let mut stale = Setting::default();
        stale.connections = Vec::new();
        stale.connected_connection_ids = Vec::new();
        stale.active_connection_id = MANAGED_CONNECTION_ID.to_string();

        let mut current = Setting::default();
        current.connections = vec![DshConnection {
            id: "external-1".to_string(),
            name: "Development".to_string(),
            url: "http://127.0.0.1:3081/".to_string(),
        }];
        current.active_connection_id = "external-1".to_string();
        current.connected_connection_ids = vec!["external-1".to_string()];
        current.next_connection_id = 2;

        let merged = preserve_persisted_fields(stale, &current);

        assert_eq!(merged.connections.len(), 1);
        assert_eq!(merged.connected_connection_ids, ["external-1"]);
        assert_eq!(merged.active_connection_id, "external-1");
        assert_eq!(merged.next_connection_id, 2);
    }

    #[test]
    fn legacy_active_connection_becomes_a_connected_workspace() {
        let mut setting = Setting {
            connections: vec![DshConnection {
                id: "external-1".to_string(),
                name: "Development".to_string(),
                url: "http://127.0.0.1:3081/".to_string(),
            }],
            active_connection_id: "external-1".to_string(),
            connection_selection_initialized: false,
            ..Default::default()
        };

        normalize_connections(&mut setting);

        assert_eq!(setting.connected_connection_ids, ["external-1"]);
        assert!(setting.connection_selection_initialized);
    }
}
