//! 外部 Harness 的无特权内容桥。
//!
//! 只处理 iframe URL 显式标记为 external 的页面：隐藏其重复侧栏、利用该页面自己
//! 已有的会话 cookie 获取工作区摘要，并把摘要交给父窗口。脚本不调用 Tauri API，
//! 也不会接收其它连接的地址或配置。

/// 外部 iframe 内无特权工作区快照与内容布局脚本。
pub(crate) const EXTERNAL_WORKSPACE_BRIDGE_JS: &str = include_str!("external_workspace.js.inc");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_bridge_is_opt_in_and_has_no_native_capability() {
        assert!(EXTERNAL_WORKSPACE_BRIDGE_JS.contains("dsh-desktop-external"));
        assert!(EXTERNAL_WORKSPACE_BRIDGE_JS.contains("dsh://external-workspace:refresh"));
        assert!(EXTERNAL_WORKSPACE_BRIDGE_JS.contains("dsh://external-workspace:tree"));
        assert!(!EXTERNAL_WORKSPACE_BRIDGE_JS.contains("__TAURI__"));
    }
}
