//! DSH 插件导出的无特权外部页面适配器；不含配置、树渲染或原生 API。
//!
//! 托管页面由 DSH 自己加载插件。外部适配器只有收到插件桌面组件发出的
//! 握手后才启动；插件卸载时桌面组件销毁外部 iframe，终止全部任务。

pub(crate) const EXTERNAL_CONNECTIONS_ADAPTER: &str =
    include_str!("../../../plugins/dsh-tauri-connections/dist/external.js");
