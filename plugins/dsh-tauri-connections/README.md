# DSH Connections

DSH 插件 `dsh-tauri-connections` 提供多连接工作区树、连接右键菜单，以及 Desktop「配置 → 应用」中的统一连接列表。

## 使用

只需安装本 fork 的一个 Desktop 安装包：插件随包分发，启动时自动安装、挂载，无需单独下载插件包。连接配置保留在 Desktop 原有配置文件中，升级无需重新添加地址。

在「配置 → 应用 → DSH 连接」添加 HTTP(S) 地址，按连接勾选「在工作区显示」。多个连接同时保留，选择会话只改变当前显示内容。工作区树层级为「连接名称 → 工作区 → 会话」，不增加侧边栏。连接名称可右键重命名；外部连接还可编辑地址、断开或删除。改地址先探测，失败不覆盖原连接；仅重命名不要求服务在线。删除只移除 Desktop 记录，不删除远端数据。

此包不是通用浏览器多服务器客户端。普通浏览器访问不改变界面；旧版 Desktop 需要升级，才能提供连接配置与多 iframe 宿主。不要在旧版壳层中同时使用旧工作区注入和本插件。

外部 DSH 无需安装插件。Desktop 在嵌入页启动前将随包客户端注册到 DSH 的 Cordis 启动流程，通过会话 API 按 ID 打开，包括同名或未渲染会话；不写远端档案或安装目录。此接入使用 DSH 的 `__ModuleLoader__.create()` 和客户端插件列表，已在 0.1.1-rc.2 验证。旧版或不兼容的启动器退回唯一可见标题匹配，无法确定目标时提示打开失败，不猜测会话。

## 组成和生命周期

- `./client`：标准 DSH 客户端入口，通过 `ctx.effect` 挂载工作区分组；卸载时还原原工作区节点、移除菜单、观察器和监听器。
- `./desktop`：Desktop 构建期入口，提供连接列表、编辑器、共享状态和并行 iframe。Desktop 保留原生存储、探测与本地服务进程管理适配。
- `dist/external.js`：同包生成的无特权外部页适配器。文档创建时注册客户端插件，等待可信 Desktop 父页面握手后访问外部页自身的 DSH API，不开放 Tauri 调用。已装客户端插件的页面不重复注册。

切换当前显示不会重建其他 iframe；断开、删除或更改地址会销毁对应 iframe，取消该页的请求。卸载客户端插件会移除扩展界面并关闭外部 iframe，但不删除保存的连接，也不停止任何外部 DSH。内置插件在 Desktop 下次启动时会自动修复安装。

本地 DSH 承载公共工作区树，因此本地服务停止或重启时，嵌入页会随壳层重新建立；远端服务和远端运行中的任务不受进程控制。外部页面可能受登录、TLS 证书、CSP 或禁止嵌入策略限制，保存可访问地址不等于嵌入已连接；列表状态以页面握手和 API 响应为准。非本机 HTTP 会明文传输数据，远程连接应使用可信 HTTPS。

## 开发

在仓库根目录运行 `pnpm install`，随后 `pnpm --dir plugins/dsh-tauri-connections build`。生成的 `dist` 同时用于独立插件包和 Desktop 资源；不手改 Rust 注入字符串。`pnpm build` 会重新构建并收集此工作区插件。已有其他内置插件缓存时，可设置 `DSH_LOCAL_PLUGIN_BUILD=1` 复用缓存进行本地构建。

运行 `pnpm exec vitest run test/connections-plugin.test.ts test/connections-desktop.test.tsx test/external-client-entry.test.ts` 验证启动注册、卸载、消息来源、编辑失败保留和并行连接。`test/manual/README.md` 提供真实 DSH 浏览器验收入口。开发者可在本目录通过 `pnpm pack` 检查标准插件包结构；用户安装只需要 Desktop 安装包。
