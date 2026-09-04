# GitNest M3 实施计划与治理契约

- 日期：2026-09-04
- 状态：全部完成（M3、正式版本三轮硬化与 1.0.0 最终总集成验收通过）
- 依据：`docs/superpowers/specs/2026-09-04-gitnest-workspace-architecture-design.md`
- 前置里程碑：M1 与 M2 已完成并验收
- 执行方式：主流程直接开发，不调用 Superpowers 研发类 Skill
- Git 约束：不创建额外 worktree，不提交

## 治理边界

- `D:\code\sc\sc_code` 继续仅作只读回归样本；全部 Worktree 写入、移动、Prune、Remove、恢复和安装测试只作用于自动创建的临时目录。
- Renderer 只能发送受控 Worktree 联合命令，不得发送任意 Git 参数、文件删除参数、可执行文件或 shell 字符串。
- Worktree Create/Move 的目标路径必须是用户明确选择的绝对路径，或位于已配置 Workspace 根；执行前与实际入队后都重新解析和校验。
- Primary Worktree 永不允许 Remove；首版不提供强制删除脏 Worktree。
- Prune 只清理 Git 登记信息，不删除仍存在目录；Remove 只调用受控 `git worktree remove`，不自行递归删除路径。
- 每个 Task 使用一次主流程有界自审；同一 Finding 连续三轮失败则返回计划，不执行第四次盲修。

## 交付顺序

```text
GN-M3-01 Worktree 安全管理
        ↓
GN-M3-02 恢复、迁移与诊断
        ↓
GN-M3-03 Windows 正式交付
        ↓
正式版本三轮最终硬化与总集成
```

## Task GN-M3-01 验收闭包

- Task 状态：
  - 已完成并验收。
- 单一交付目标：
  - 通过短期、参数绑定且执行前重验的两阶段协议完成 Worktree Create、Lock、Unlock、Move、Repair、Prune 和安全 Remove。
- 业务不变量族：
  - 所有目标基于 RepositoryInstance/Worktree 的已登记身份，不按名称或 Remote 合并。
  - Create 校验目标不存在或为空、分支未被其他 Worktree 检出，并要求明确目标路径。
  - Lock/Unlock 保留锁定原因；Move 只移动 Git 已登记 Worktree。
  - Repair 只修复 Git 登记；Prune 先 dry-run 列出候选且不删除现存目录。
  - Remove 拒绝 Primary、Locked、Dirty、冲突或未登记 Worktree；不支持 `--force`。
  - 同一 RepositoryInstance 的 Worktree 与远程/引用写操作严格串行，长操作支持取消和 Windows 进程树终止。
- 可观察验收证据：
  - 临时真实 Repository + linked worktree 覆盖每个成功路径和拒绝路径。
  - Preflight 过期、参数/路径/候选变化时旧确认拒绝。
  - 1440 × 900 与 1100 × 812 的 Worktrees 页面、确认对话框和操作中心无横向溢出。
- 独立回滚边界：
  - 回滚 Worktree 命令、预检服务和页面，不影响 M2 Git 工作流。
- Finding 状态与证据：
  - 已修复：Git 写入成功后拓扑重扫失败不得把操作误报为失败；运行时测试确认成功态保留并附带警告。
  - 已修复：Prune dry-run 前后增加候选双读取一致性校验，候选变化时以 `PREFLIGHT_CHANGED` 拒绝旧确认。
  - 已修复：Primary 路径暂时不可用时可回退到其他可访问 linked Worktree；Move/Remove 禁止以被操作目录自身作为命令锚点。
  - 已修复：Create/Move 目标通过真实祖先解析抵御符号链接绕过；Workspace 根外路径必须持有 Main 目录选择产生的短期授权。
  - 验收：`pnpm typecheck` 通过；`pnpm test` 为 42 个文件、176 项测试全部通过；`pnpm build` 通过。
  - 真实 Electron：临时 Workspace 完成 Create、Lock、Unlock、Move、Repair、Prune、Remove，七项 Operation 均为 `succeeded`；无 Renderer 运行时错误和 Node 全局泄露。
  - 截图：`test-results/gn-m3-01-1440-worktrees.png`、`gn-m3-01-1100-worktrees.png`、`gn-m3-01-1100-create-preflight.png`、`gn-m3-01-1100-remove-preflight.png`、`gn-m3-01-1100-operation-center.png`。
  - 只读样本哈希保持不变；无 Electron 进程或 `gitnest-e2e-m3-worktree-*` 临时目录残留。
- 当前修复失败计数：
  - 0；一次局部变量重命名回归由首轮针对性测试捕获并在第 1 次修复后通过，未出现同一 Finding 连续失败。

## Task GN-M3-02 验收闭包

- Task 状态：
  - 已完成并验收。
- 单一交付目标：
  - 提供异常退出恢复、存储迁移、窗口状态恢复和脱敏诊断日志，使应用在损坏配置、暂时离线目录和中断操作后可解释地恢复。
- 业务不变量族：
  - 所有持久化文档带 schema version，迁移失败保留原文件并阻止静默覆盖。
  - 原子写入临时文件可在启动时识别和清理；中断中的 Operation 恢复为明确终态，不伪造成功。
  - 诊断日志容量受限、轮转、默认脱敏 Token/Authorization/URL userinfo/私钥内容和用户输入正文。
  - 窗口状态恢复必须钳制到当前显示器可见区域和最小尺寸。
- 可观察验收证据：
  - 损坏 JSON、旧 schema、残留临时文件、离线根目录和中断 Operation 恢复测试通过。
  - 日志脱敏与容量轮转测试通过，敏感 canary 不出现在文件、IPC 或截图。
  - 多显示器/分辨率变化窗口恢复测试通过。
- 独立回滚边界：
  - 回滚恢复、迁移和诊断适配器，不移除已验收 Git/Worktree 能力。
- Finding 状态与证据：
  - 已修复：损坏 Workspace 下窗口聚焦触发的后台刷新 Promise 未捕获；Main 生命周期后台任务现统一捕获并写入脱敏诊断，生产损坏启动无 `UnhandledPromiseRejection`。
  - 已修复：诊断日志除 Token、Authorization、URL userinfo、私钥和用户正文外，新增用户目录及环境变量值脱敏。
  - 已修复：迁移后的 Workspace 增加 Repository/Worktree 完整归属、Primary 唯一性和 `selectedTarget` 可见性校验，拒绝语法合法但语义损坏的配置。
  - 原子恢复：同目录 pending JSON 在最终文件缺失时恢复最新有效版本；最终文件有效时清理残留；无有效版本或迁移失败时保留原文并阻止覆盖。
  - Operation 恢复：queued/running/cancelling 在下次启动恢复为明确 `interrupted` 终态，不推断成功、失败或回滚，并持久化该结论。
  - 窗口恢复：v0→v1 迁移，多显示器交叠选择、断开显示器回退、尺寸和坐标钳制均通过。
  - 离线根目录：真实临时目录移走时保留上次拓扑与 Repository ID，恢复后自动清除扫描问题。
  - 验收：`pnpm typecheck` 通过；`pnpm test` 为 45 个文件、199 项测试全部通过；`pnpm build` 通过。
  - 真实 Electron：正常启动→v0/pending/屏幕外状态→恢复启动→损坏配置启动三阶段通过；Workspace/Snapshot/Operation/Window 均迁移为 schema v1，Token canary 不在日志，损坏 Workspace 未覆盖。
  - 截图：`test-results/gn-m3-02-1440-interrupted-operation.png`。
  - 只读样本哈希保持不变；无 Electron 进程或 `gitnest-e2e-m3-recovery-*` 临时目录残留。
- 当前修复失败计数：
  - 0；两个 E2E Harness 假设分别在第 1 次修正后通过，产品 Finding 在第 1 次修复后通过完整重跑，未出现同一 Finding 连续失败。

## Task GN-M3-03 验收闭包

- Task 状态：
  - 已完成并验收。
- 单一交付目标：
  - 生成并验证 Windows x64 安装包与便携压缩包，完成首个正式版本的启动、升级、卸载与数据保留边界。
- 业务不变量族：
  - 安装与升级不修改用户仓库；卸载默认保留 AppData，只有用户明确选择时清理。
  - 包内启用安全 Electron 配置，不携带开发服务器、测试 Token、临时仓库、源码映射或调试端口。
  - 首个正式版本不启用自动更新；未配置代码签名时明确标记构建状态。
- 可观察验收证据：
  - installer 与 portable artifact 可生成并在干净临时用户数据目录启动。
  - 安装、覆盖升级、便携启动、卸载后数据保留和无仓库写入检查通过。
  - 包内容审计、SHA-256 清单与启动截图留档。
- 独立回滚边界：
  - 回滚打包配置与发布脚本，不修改应用业务层。
- Finding 状态与证据：
  - 已修复：electron-builder 默认下载解压路径在当前 Windows 卷上连续两次于 `win-unpacked.tmp → win-unpacked` 原子重命名时报 `EPERM`；原生目录重命名验证成功后，发布脚本改为按 Electron 版本、必需文件和 PE x64 头校验本地已解压分发包，并通过 `electronDist` 走无临时重命名的复制路径。
  - 已修复：electron-builder 会根据桌面包的生产依赖自动把 workspace 源码与 React 运行库加入 ASAR；构建产物确认仅外部引用 Electron 后，将这些依赖归为构建期依赖并显式排除根 `node_modules`，ASAR 从 222 个条目收敛为 11 个白名单条目。
  - 已修复：发布审计补齐 Windows ASAR 路径分隔符适配、PowerShell 7/Windows PowerShell 签名探测回退、builder 临时图标/调试配置清理，以及 `default_app.asar`、原始 `version`、更新元数据、源码映射、测试内容和开发服务器标记拒绝。
  - 正式产物：`GitNest-Setup-1.0.0-x64.exe`、`GitNest-Portable-1.0.0-x64.exe`、`GitNest-1.0.0-x64.zip` 与 `win-unpacked` 全部生成；发布清单和 `SHA256SUMS.txt` 校验通过。当前未配置代码签名，三个可执行交付物均明确记录为 `NotSigned`，自动更新为关闭。
  - 真实分发烟测：unpacked、ZIP、Portable、0.9.0 安装版与覆盖升级后的 1.0.0 安装版均在独立用户数据目录启动；Renderer 中 `require`、`process`、`Buffer` 均不可见，受控 Preload Bridge 可用。
  - 安装边界：0.9.0 → 1.0.0 覆盖升级成功；用户数据 sentinel 保留；正式安装器创建桌面和开始菜单快捷方式，静默卸载后安装目录、快捷方式和卸载注册表项均消失，而 AppData sentinel 保留。
  - 截图：`test-results/gn-m3-03-packaged-startup.png`；1440 × 900 无横向溢出，运行时显示 GitNest 1.0.0 / Electron 44.2.0。
  - 只读样本哈希保持不变；无 GitNest/Electron 进程、卸载注册表项、快捷方式或 `gitnest-e2e-m3-delivery-*` 临时目录残留。
- 当前修复失败计数：
  - 0；默认解压 EPERM 在两次相同失败后改用有源码依据的新路径并通过，未触发第三次盲修；后续包内容与审计 Harness Finding 均在第 1 次针对性修复后通过。

## 正式版本三轮最终硬化

当前状态：三轮与最终总集成全部通过。

1. 正确性/回归轮：全量类型、单元、集成、生产 Electron、安装/便携启动与样本只读哈希。
2. 安全性/韧性轮：IPC 越权、路径逃逸、命令注入、Token canary、取消/中断、损坏存储、Prune/Remove 边界和包内容审计。
3. UX/性能轮：1440/1100、键盘与焦点、Loading/Empty/Error、批量操作、启动缓存、扫描/查询并发、内存与进程残留。

三轮完成后再执行一次正式版本总集成；只有有证据的 Finding 才修改产品。

### 第 1 轮：正确性/回归

- 状态：通过。
- `pnpm typecheck` 通过；`pnpm test` 为 45 个文件、199 项测试全部通过；当前源码生产构建通过。
- M2 真实 Electron：Fetch、Pull、Push、分支创建/切换/重命名/删除和取消 Push 全部通过。
- M3 Worktree 真实 Electron：Create、Lock、Unlock、Move、Repair、Remove、Prune 全部通过；1440 与 1100 视图重新留档。
- M3 恢复真实 Electron：Workspace/Snapshot/Operation/Window schema v1、运行中操作恢复为 `interrupted`、Token 日志脱敏与损坏 Workspace 保留全部通过。
- Finding：三个源码 Electron 烟测原先硬编码活动 `node_modules/electron/dist`，在 pnpm 活动变体未解压时不可复现运行；已统一复用发布脚本的版本/文件/PE x64 校验解析器。
- 无 GitNest/Electron 进程或本轮 `gitnest-e2e-*` 临时目录残留；只读样本哈希保持不变。

### 第 2 轮：安全性/韧性

- 状态：通过。
- 定向测试为 22 个文件、129 项全部通过，覆盖 IPC sender 与参数拒绝、Preload 白名单、BrowserWindow 安全开关、路径授权、账号 Token 生命周期、Credential Vault、AskPass nonce/host 绑定、诊断脱敏、预检变化、取消与 Windows 进程树、Worktree Remove/Prune、损坏与迁移存储。
- 静态边界扫描未发现 `shell: true`、Renderer 直接 IPC、`nodeIntegration: true`、`contextIsolation: false`、`webSecurity: false` 或普通 Force Push；`ipcRenderer` 只存在于 Preload，产品仅实现受约束的 `--force-with-lease`。
- 发布包审计再次通过：ASAR 11 个白名单条目，无源码映射、测试内容、开发服务器、自动更新元数据或 secret marker。
- 真实恢复流程再次确认 Token canary 不进入日志、损坏 Workspace 不覆盖、非终态操作恢复为 `interrupted`；真实 Worktree 流程再次确认安全 Remove/Prune 与二阶段重验。
- 本轮无新增产品 Finding；无 GitNest/Electron 进程或本轮临时目录残留，只读样本哈希保持不变。

### 第 3 轮：UX/性能

- 状态：通过。
- 状态与并发定向测试为 10 个文件、35 项全部通过，覆盖 Empty/Error、批量部分成功、Mutation/Command 完成反馈、启动缓存、查询取消与唯一标识、四路 Git 读取上限、重复请求合并、Watcher 防抖与轮询降级。
- 已修复：仓库与 Worktree 确认对话框原先只有初始焦点和 Escape，没有 Tab 焦点陷阱；新增共享 Modal 焦点管理，Tab/Shift+Tab 始终留在对话框，关闭时恢复原焦点，危险操作默认聚焦“取消”而非确认。
- 焦点 Hook 与两个命令控制器共 3 个文件、10 项测试通过；M2 Pull/Force-with-lease 与 M3 Create/Remove 在真实 Chromium 中通过初始焦点及 Tab/Shift+Tab 断言。
- 1440 Worktree/账号页、1100 普通与危险确认框/操作中心完成目检；无横向溢出、裁切或模糊覆盖，风险色、焦点轮廓和状态层级清晰。
- 性能优化：相同预封装目录下，Windows ZIP/NSIS/Portable 的 `normal` 压缩总耗时 194.48 秒，对比 `maximum` 约 525 秒缩短约 63%；ZIP 仅增加 339,725 字节（约 0.24%），Setup 增加 76 字节，Portable 增加 1 字节，因此正式配置改为 `normal`。
- 打包前测得 unpacked、ZIP、Portable 冷启动分别约 0.77 秒、5.42 秒和 10.83 秒；最终总集成将以优化后的正式包重新记录。
- 无 GitNest/Electron 进程或本轮临时目录残留；只读样本哈希保持不变。

## 1.0.0 最终总集成

- 状态：通过。
- 最终语法检查和 `pnpm typecheck` 通过；`pnpm test` 为 46 个文件、200 项测试全部通过。
- 使用最终 `1.0 · Release candidate` / `v1.0.0` 界面与 `compression: normal` 重建 Windows x64 正式产物；Release build 无源码映射，ASAR 仅 11 个白名单条目。
- 发布审计通过：无生产 `node_modules`、测试内容、开发服务器、调试端口、secret marker、自动更新元数据、`default_app.asar` 或原始 Electron `version`；当前无签名证书，交付物明确记录为 `NotSigned`。
- 最终产物与 SHA-256：
  - `GitNest-Setup-1.0.0-x64.exe`，92,735,547 字节，`D840CBB55CE7EF7E557C871C3B7DCF4DA4B3460A5D8F53ECDEE66EFA95BE4E57`。
  - `GitNest-Portable-1.0.0-x64.exe`，92,493,138 字节，`48D111D5A763377FAFA360159A5430FF933A85FC306DDBD0452A8F5113AD8516`。
  - `GitNest-1.0.0-x64.zip`，141,533,673 字节，`93313B9651F782C29BEEC89E57AAD82B22DA4C26F523C093DF677DD46008A019`。
  - `win-unpacked/GitNest.exe`，246,202,368 字节，`88E8C07FB4ED9D6E7D126CE5BB9410B0C05E76B657ED41F503FA29AE988D6111`。
- 最终分发烟测通过：unpacked、ZIP、Portable、0.9.0 安装版和覆盖升级后的 1.0.0 安装版均启动；最终记录的启动时间约为 1.10 秒、5.40 秒、11.44 秒、5.51 秒和 5.24 秒。
- 0.9.0 → 1.0.0 覆盖升级、用户数据保留、正式快捷方式创建、静默卸载、安装目录/快捷方式/卸载注册表清理全部通过；Renderer Node globals 保持隔离。
- 最终 M2、M3 Worktree 与 M3 恢复三条生产 Electron 流程全部通过。恢复脚本曾单次命中活动原子写入的短暂 `.tmp` 窗口；改为连续两次稳定无 pending 的时序断言后通过，未修改产品持久化逻辑。
- `test-results/gn-m3-03-packaged-startup.png` 为最终安装版 1440 × 900 截图；其他 M2/M3 1440/1100 截图同步刷新。
- 两个早期 cleanup-blocked 测试夹具已在无关联进程后按精确路径删除；最终系统 Temp 无 GitNest 测试目录，无 GitNest/Electron 进程、卸载注册表项或快捷方式残留。
- `D:\code\sc\sc_code` 两个只读 Git index 的长度与 SHA-256 全程保持基线不变。
- 按约束未创建额外 Git worktree、未提交；工作区仍为 `main` 的未提交研发成果。
