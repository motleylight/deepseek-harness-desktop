//! 托管 Harness 的工作区树桥。
//!
//! 脚本只运行在带有桌面端托管标记的本机 Harness iframe 内。它复用原有工作区树
//! 作为本机实例的子项，并把外部实例目录及其只读快照插入同一棵树；所有写操作
//! 都经 postMessage 回到宿主，由宿主按保存的连接 id 执行。

/// iframe 内工作区树脚本。
pub(crate) const WORKSPACE_TREE_BRIDGE_JS: &str = include_str!("workspace_tree.js.inc");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_tree_uses_parent_messages_and_no_tauri_api() {
        assert!(WORKSPACE_TREE_BRIDGE_JS.contains("dsh-desktop-workspace-tree"));
        assert!(WORKSPACE_TREE_BRIDGE_JS.contains("dsh://workspace-tree:state"));
        assert!(WORKSPACE_TREE_BRIDGE_JS.contains("dsh://workspace-tree:action"));
        assert!(WORKSPACE_TREE_BRIDGE_JS.contains("dsh://workspace-tree:layout"));
        assert!(!WORKSPACE_TREE_BRIDGE_JS.contains("__TAURI__"));
    }
}
