# Workspace 刷新调度与操作历史分离设计

**日期：** 2026-09-20

**状态：** 已批准并实施

## 目标

在不降低当前仓库状态和 Diff 数据及时性的前提下，解决后台状态刷新频繁占满操作中心的问题，并让包含多个顶层条目的 Workspace 按用户当前关注范围分层刷新，而不是共享一套无差别频率。

本设计完成后：

1. 操作中心只保留用户明确触发的任务、Git 写操作和需要人工处理的后台失败。
2. watcher、窗口聚焦、心跳和降级轮询成功时不再产生持久化操作记录。
3. 当前目标、当前顶层条目和其他顶层条目使用不同刷新优先级。
4. 同一目标的重复信号合并为一个在途刷新和至多一个尾随刷新。
5. watcher 正常时保持秒级更新；watcher 不可用时按优先级分散轮询，避免同时刷新全部目标。
6. 后台刷新原因、合并数量、执行数量和失败数量通过有界诊断统计保留，不再借用操作历史表达。

## 已确认的产品决策

- 采用“操作历史与后台数据保鲜分离”的方案。
- 自动刷新成功不进入操作中心。
- 用户手动刷新、Workspace 手动重扫、Fetch、Pull、Push、提交、暂存、分支和 Worktree 操作继续进入操作中心。
- 后台刷新失败可以进入操作中心，但相同失败必须合并，不能形成新的记录洪峰。
- 当前代码中的单 Workspace 模型保持不变：多个用户添加的目录是一个 `default` Workspace 下的多个顶层条目，不新增多 Workspace 文档管理。
- 操作历史仍保留最近 30 条；自动成功记录移除后，暂不扩大历史容量。
- 不新增用户可配置的刷新频率设置。默认调度必须在大多数 Workspace 中直接可用。
- 不改变 Git 写操作的串行化、确认、取消和刷新后置行为。
- 不改变 Snapshot 的持久化位置和原子写入机制。

## 当前问题

### 操作语义混合

`WorkspaceRuntimeService` 当前在每次 `#runStatusRefresh` 开始时创建一个 `status` 操作。触发原因包括：

- 启动刷新；
- Workspace 结构变化；
- watcher 文件事件；
- watcher 降级后的轮询；
- 应用窗口聚焦；
- 选中目标心跳；
- 手动刷新后的状态读取。

操作完成后，原始原因会被统一的“状态刷新完成”消息覆盖。操作历史只能看出刷新了多少目标，无法判断它来自用户操作还是后台保鲜。

操作列表最多保留 30 条，因此高频单目标 watcher 刷新可以在短时间内挤掉 Fetch、提交和失败任务。

### 调度参数全局共享

当前默认值为：

- 当前目标 watcher 防抖：400ms；
- 后台目标 watcher 防抖：2s；
- watcher 降级全量轮询：60s；
- 选中目标心跳检查：15s；
- 窗口聚焦陈旧阈值：30s。

这些参数应用于一个 Workspace 下的所有顶层条目。选中目标与其他目标只在 watcher 防抖时存在差异；降级轮询和聚焦刷新没有按顶层条目活跃程度分层。

### 刷新职责集中

`WorkspaceRuntimeService` 同时负责：

- Workspace 配置变化；
- watcher 生命周期；
- 定时器；
- 信号防抖；
- 调度优先级；
- Git 读取；
- Snapshot 合并和持久化；
- 用户操作历史；
- 写操作串行化。

刷新信号与操作记录在同一个方法中创建，导致无法单独改变记录策略而不触碰执行逻辑。

## 非目标

- 不增加 Fetch、Pull 或其他远端网络操作的自动执行频率。
- 不解析各仓库的 `.gitignore` 来预过滤文件事件。
- 不新增收藏仓库功能。
- 不新增用户自定义刷新周期。
- 不修改 Repository、Worktree 或 Workspace 的持久化身份模型。
- 不修改操作中心整体布局、筛选方式和批量 Git 操作入口。
- 不将操作历史改造成完整审计日志或无限增长日志。
- 不改变 `contentVersion` 对 Diff 刷新的现有职责。

## 考虑过的方案

### 方案一：只调大现有时间间隔

把选中目标心跳从 15 秒改为 60 秒，把 watcher 防抖改得更长。

优点是修改范围小。缺点是后台成功刷新仍会进入操作中心，多个顶层条目仍使用相同频率，持续文件事件仍会逐条产生记录，只是速度变慢。

### 方案二：保留所有刷新记录，但按时间窗口聚合

一分钟内的 watcher 刷新共用一条 `status` 操作。

该方案可以减少记录数量，但操作中心仍然混合用户任务和数据保鲜。聚合窗口还会使任务状态长期停留在运行中，难以表达单次 Git 操作的终态。

### 方案三：分离操作历史与刷新调度

引入内部刷新调度器。调度器只管理目标、优先级、到期时间和合并状态；运行时负责 Git 读取和 Snapshot；操作历史只由用户任务或后台失败创建。

这是选定方案。它同时解决记录语义、调度扩展和诊断可观测性问题，并保留现有 Git 读取、Snapshot 和操作 UI。

## 术语

### 用户操作

用户在界面中明确发起、能够感知开始和终态的动作：

- 手动 Workspace 刷新或重扫；
- Stage、Unstage、Discard、Commit；
- Stash Apply、Drop、Pop；
- Fetch、Pull、Push；
- 分支创建、切换、重命名、删除；
- Worktree 创建、锁定、移动、修复、裁剪和移除。

用户操作必须拥有稳定操作 ID，并显示排队、运行、进度和终态。

### 后台刷新

用于保持本地只读状态新鲜、不代表用户任务的 Git 读取：

- `startup`：应用启动后的初始状态填充；
- `workspace-change`：顶层条目或拓扑变化后的目标状态补齐；
- `watcher`：文件或 Git 元数据事件；
- `focus`：应用重新回到前台后的陈旧状态恢复；
- `heartbeat`：watcher 正常时选中目标的漏事件校验；
- `polling`：watcher 不可用时的降级轮询。

后台刷新成功只更新 Snapshot、监控状态和诊断统计，不创建操作记录。

### 刷新优先级

- `selected`：`workspace.selectedTarget`。
- `selected-entry`：属于 `workspace.selectedEntryId`，但不是当前选中目标。
- `background`：属于其他顶层条目的有效目标。

一个目标同时属于多个顶层条目时，取最高优先级。

## 架构

### `WorkspaceRefreshScheduler`

在 `packages/application/src/workspace` 增加内部刷新调度器。调度器不读取 Git、不写 Snapshot、不创建操作，只维护调度状态并调用运行时提供的执行回调。

概念接口：

```ts
type BackgroundRefreshReason =
  | "startup"
  | "workspace-change"
  | "watcher"
  | "focus"
  | "heartbeat"
  | "polling";

type RefreshPriority =
  | "selected"
  | "selected-entry"
  | "background";

interface RefreshRequest {
  target: RepositoryTarget;
  reason: BackgroundRefreshReason;
  forceContentVersion: boolean;
  requestedAt: string;
}

interface ScheduledRefresh {
  target: RepositoryTarget;
  priority: RefreshPriority;
  reasons: Set<BackgroundRefreshReason>;
  forceContentVersion: boolean;
  dueAt: number;
  inFlight: boolean;
  trailing: boolean;
}
```

调度器提供以下行为：

- 更新 Workspace 目标和当前优先级；
- 接收 watcher、focus、heartbeat、polling 和 startup 信号；
- 合并同一目标的重复请求；
- 暂停、恢复和释放定时资源；
- 在到期时按优先级提交目标；
- 记录 requested、merged、executed、changed 和 failed 计数。

调度器不得依赖 Renderer、Electron、Git CLI 或 JSON Repository。

### `WorkspaceRuntimeService`

运行时继续负责：

- 解析当前 Workspace 和目标；
- 维护写操作和仓库操作串行化；
- 使用现有并发限制读取 Git；
- 将读取结果映射为 `RepositoryStatusSnapshot`；
- 更新 `contentVersion`、`refreshPending`、`stale` 和错误状态；
- 串行保存 Snapshot；
- 创建和持久化用户操作；
- 将后台失败转换成有界失败记录。

现有 `#runStatusRefresh` 拆为不创建操作的内部执行方法：

```ts
interface RefreshBatchResult {
  requested: number;
  succeeded: number;
  failed: number;
  changed: number;
  failures: Array<{
    target: RepositoryTarget;
    code: string;
    message: string;
  }>;
}

refreshTargets(
  requests: RefreshRequest[]
): Promise<RefreshBatchResult>;
```

调用方决定结果如何呈现：

- 后台调度器：更新监控、统计和失败事件；
- 手动 Workspace 刷新：更新同一个用户操作的进度和终态；
- Git 写操作：继续更新原写操作，不创建嵌套 `status` 操作。

### Main 进程前后台状态

Main 进程维护“应用是否在前台”的布尔状态：

- 任意 GitNest 窗口获得焦点时设为前台；
- 最后一个 GitNest 窗口失去焦点时设为后台；
- 状态变化传给 `WorkspaceRuntimeService`；
- 后台期间停止 watcher 模式下的选中目标心跳；
- 回到前台时执行一次选中目标陈旧检查。

独立 Diff 窗口获得焦点也视为应用处于前台。

## 调度规则

### watcher 正常

| 目标级别 | watcher 防抖 | 最小执行间隔 | 兜底检查 |
| --- | ---: | ---: | ---: |
| selected | 400ms | 1s | 应用前台时 60s |
| selected-entry | 2s | 5s | 无 |
| background | 2s | 5s | 无 |

规则：

1. 防抖从最后一个相关事件开始计算。
2. 最小执行间隔从上一次该目标刷新开始时间计算。
3. 到期时已有刷新在途，只设置一个 `trailing` 标记。
4. 在途刷新结束后，若存在 `trailing`，重新按最新防抖和最小间隔计算一次。
5. 连续多少个事件都不能产生两个尾随刷新。
6. watcher 事件携带 `forceContentVersion: true`，因为已处于修改状态的文件内容可能变化，而 staged/unstaged 数量和路径状态保持不变。
7. watcher 正常时的 heartbeat 使用 `forceContentVersion: false`；Git 状态签名未变化时不得仅因心跳让 Diff 重载。

### 应用重新获得焦点

只立即检查选中目标：

- 没有 Snapshot、Snapshot 标记为 stale、上次成功刷新无效，或距上次刷新达到 30 秒时入队；
- 当前目标已有在途或已排队刷新时合并，不新增执行；
- 不再因一次窗口聚焦同时刷新全部顶层条目。

当前顶层条目和其他顶层条目继续依赖 watcher；如果 watcher 已降级，使用轮询规则。

### watcher 降级轮询

| 目标级别 | 目标周期 |
| --- | ---: |
| selected | 15s |
| selected-entry | 60s |
| background | 180s |

轮询不是三个同时触发的全量 `setInterval`：

1. 调度器维护每个目标独立的 `nextDueAt`。
2. 进入 polling 模式时，选中目标立即到期。
3. 当前顶层条目的其余目标均匀分布在接下来 60 秒内。
4. 后台目标均匀分布在接下来 180 秒内。
5. 每个调度 tick 只提交当前已到期目标；Git 读取继续受现有并发上限 4 约束。
6. 目标完成后以其优先级周期计算下一次到期时间。
7. 选择变化时重新计算相关目标优先级；新选中目标若陈旧则立即到期。
8. polling 读取使用 `forceContentVersion: true`，用于在 watcher 不可用时恢复对同状态文件内容变化的感知。

实际完成时间可能受 Git 命令耗时和并发队列影响，周期表示目标开始时间，不构成硬实时承诺。

### 启动

启动流程：

1. 读取 Workspace 和最近 Snapshot，立即发布缓存状态。
2. 自动执行 Workspace 拓扑重扫，但不创建成功操作记录。
3. 建立 watcher；失败时进入 polling。
4. 将选中目标作为最高优先级立即刷新。
5. 当前顶层条目其余目标排在后台目标之前。
6. 初次填充完成后进入正常 watcher 或 polling 调度。

启动成功不进入操作中心。启动重扫或状态读取失败时按“后台失败”规则记录。

### Workspace 结构变化

接受新 Workspace 前后比较目标键：

- 已删除目标：删除 Snapshot、调度状态和待执行请求；
- 新增目标：按当前优先级入队；
- 保留目标：保留 Snapshot，不因无关顶层条目变化重新全量读取；
- 选中目标变化：更新优先级并按陈旧规则决定是否立即刷新。

手动“重新扫描 Workspace”仍是一个用户操作。该操作包含拓扑扫描和需要更新的目标状态读取，不再额外创建一个嵌套 `status` 操作。

### 手动 Workspace 刷新

手动刷新拥有一个 `scan` 操作：

1. 扫描拓扑；
2. 更新 watcher 和调度目标；
3. 复用已有在途 Git 读取；
4. 按 selected、selected-entry、background 顺序刷新全部有效目标；
5. 将扫描和状态读取进度写入同一个操作；
6. 保存 Snapshot 后结束操作。

连续点击手动刷新继续返回同一个活动操作 ID。

手动刷新不永久关闭后台调度。扫描期间暂停旧 watcher 和待执行 timer，接受新 Workspace 后重建 watcher，再恢复被合并的有效信号。

## 操作历史规则

### 必须创建操作的行为

| 行为 | 操作类型 |
| --- | --- |
| 手动 Workspace 刷新或重扫 | `scan` |
| Worktree 内容写操作 | 对应 `stage`、`commit` 等类型 |
| Repository 远端或分支操作 | 对应 `fetch`、`pull`、`push` 等类型 |
| Worktree 管理操作 | 对应 `worktree-*` 类型 |
| 后台刷新失败 | 合并后的 `status` 失败类型 |

### 不得创建成功操作的行为

- 启动自动扫描和状态填充；
- Workspace 变化后的自动状态补齐；
- watcher 成功刷新；
- 窗口聚焦成功刷新；
- heartbeat 成功刷新；
- polling 成功刷新。

### 后台失败合并

一次后台刷新批次中存在失败目标时，创建或更新一个失败 `status` 操作。

合并键为：

```text
刷新原因 + 稳定错误码
```

合并窗口为 5 分钟：

- 合并窗口内的相同失败更新最近一条记录；
- `targetIds` 使用失败目标并集；
- `failed` 表示唯一失败目标数量；
- `finishedAt` 更新为最近失败时间；
- 消息包含刷新原因、失败目标数量和最近一条脱敏错误；
- 不保存文件路径、命令参数、凭据或远端响应正文；
- 超过 5 分钟后再次失败，创建新记录。

用户手动刷新失败不参与后台失败合并，直接结束对应的 `scan` 操作。

### 历史兼容

不修改 `default.operations.json` 的 Schema 版本。

加载旧记录时：

- 删除 `state: "succeeded"` 的旧 `status` 记录；
- 删除 `queued`、`running` 和 `cancelling` 的旧 `status` 记录，不将只读刷新恢复为 interrupted；
- 保留 `failed` 和 `interrupted` 的旧 `status` 记录；
- 其他操作继续使用现有恢复规则；
- 保存下一次操作状态时自然写回清理后的最近 30 条记录。

该兼容处理可能删除旧版本中由手动刷新产生的成功 `status` 子记录，但对应的 `scan` 主记录仍然保留。不会删除 Fetch、提交或其他 Git 操作。

## Snapshot 和内容版本不变量

调度优化不得破坏以下行为：

1. `refreshedAt` 表示最近一次成功读取时间。
2. `stale` 和 `refreshPending` 继续表达缓存和在途状态。
3. 状态签名变化时递增 `contentVersion`。
4. watcher 事件即使没有改变状态摘要，也递增 `contentVersion`，因为文件 Diff 内容可能发生变化。
5. polling 模式读取递增 `contentVersion`，用于弥补 watcher 不可用时无法识别同状态内容变化的问题。
6. watcher 正常时的 heartbeat 在状态签名未变化时不递增 `contentVersion`。
7. 同一目标被多个信号合并时，只应用一次最终 Snapshot。
8. 迟到结果只有在目标仍属于当前 Workspace 时才能写入。
9. Git 写操作与同目标状态读取继续遵守现有串行化边界。

## 监控与诊断

### 用户可见监控

现有 `WorkspaceMonitorState` 继续承担用户可见状态：

- `watching`、`polling` 或 `inactive`；
- 当前监听目标数量；
- watcher 降级原因；
- 最近一次文件事件时间。

状态栏和 Inspector 继续展示 watcher 是否正常以及是否已降级。操作中心不新增后台成功列表。

### 结构化诊断统计

`WorkspaceRuntimeService` 通过可选诊断回调输出有界统计，Main 进程接入现有旋转日志。

统计字段：

- monitor mode；
- reason；
- requested；
- merged；
- executed；
- changed；
- failed；
- active target count；
- pending target count；
- elapsed milliseconds。

输出规则：

- 正常刷新最多每 60 秒输出一条聚合摘要；
- watcher 降级、恢复和后台失败立即输出；
- 不记录 Workspace 路径、目标 ID、分支名、远端 URL 或 Git 输出正文；
- 诊断回调失败不得中断刷新。

该统计用于判断调度是否仍产生重复 Git 读取，不作为用户操作历史。

## Renderer 行为

操作中心继续消费 `WorkspaceOperationDto[]`，不新增后台成功记录 UI。

需要调整的文案：

- 空状态不再写“后台任务会显示在这里”；
- 改为“手动刷新、同步或 Git 操作后会显示在这里”；
- 记录指标仍表示持久化用户任务和失败事件数量；
- 当前筛选、目标跳转、取消和重试行为保持不变。

后台刷新期间，Repository Snapshot 的 `refreshPending`、状态栏和 Inspector 继续提供局部反馈。不得因操作历史中没有记录就隐藏实际 Snapshot 刷新状态。

## 错误处理

- 单目标 Git 读取失败：保留该目标最近 Snapshot，设置 Snapshot error，并进入后台失败合并。
- 部分批次失败：成功目标正常更新，失败目标保持错误状态；不得让整个批次丢失成功结果。
- Snapshot 保存失败：内存状态继续可用，监控状态和诊断记录保存失败；相同保存失败在 5 分钟内只保留一条后台失败记录。
- watcher 初始化或运行失败：关闭旧 watcher，切换到分层 polling，并立即输出降级诊断。
- polling 中单目标失败：其他目标继续按各自周期运行。
- 调度器回调抛错：捕获并记录，不产生未处理 Promise 拒绝。
- 应用退出：停止 timer、关闭 watcher、等待 Snapshot 和操作持久化尾队列。

## 测试设计

本任务优先扩展现有测试文件，不新建仅服务本次修复的临时测试文件。

### Workspace 运行时

扩展 `packages/application/src/workspace/workspace-runtime-service.test.ts`：

- watcher、focus、heartbeat 和 polling 成功不增加操作历史；
- 手动刷新只产生一个 `scan` 操作，不产生嵌套 `status` 成功记录；
- 选中目标 400ms 防抖和 1s 最小间隔；
- 当前顶层条目与后台目标使用 5s 最小间隔；
- 在途期间的多个事件只产生一个尾随刷新；
- watcher 模式 heartbeat 60s 且应用后台时停止；
- 回到前台只检查陈旧的选中目标；
- polling 模式按 15s、60s、180s 分层，并且初始目标分散到期；
- 选择变化重新分级并优先刷新新目标；
- Workspace 结构变化只刷新新增或陈旧目标；
- watcher 和 polling 的 `contentVersion` 规则保持正确；
- 相同后台失败在 5 分钟内更新同一记录；
- 不同错误码或超过窗口后创建新失败记录；
- 旧成功/活动 `status` 记录被清理，失败记录被保留；
- dispose 清理 watcher、timer、待执行和诊断汇总。

### 持久化和 DTO

如果实现不改变操作 Schema，则现有 `workspace-operation.repository` 校验保持不变，并增加旧记录清理后的保存断言。

如果实施中发现必须修改公共 DTO 或持久化 Schema，必须返回设计阶段重新确认，不能在实现计划中自行扩大。

### Renderer

扩展现有 `OperationCenterPage.test.tsx`：

- 空状态使用新的操作语义文案；
- 后台刷新成功不在传入 operations 时，指标和筛选保持正确；
- 失败 `status` 记录仍能显示目标、错误和时间。

### 验收验证

- 定向 Vitest：
  - `workspace-runtime-service.test.ts`
  - `workspace-operation.repository.test.ts`
  - `OperationCenterPage.test.tsx`
- 根 TypeScript typecheck；
- Desktop 生产构建；
- `git diff --check`；
- 开发版 Electron 运行验证：
  - 两分钟无用户操作时，成功操作记录数量保持不变；
  - 编辑选中仓库文件后，状态或 Diff 在 watcher 目标时限内更新；
  - 连续保存文件不会产生多条操作记录；
  - watcher 降级后，选中目标先刷新，其他目标分散刷新；
  - 模拟后台失败时只出现一条合并失败记录。

## 验收标准

1. watcher、focus、heartbeat、polling 和 startup 成功刷新不进入操作中心。
2. 手动 Workspace 刷新只有一个可追踪操作，并完整反映扫描和状态读取结果。
3. Fetch、提交、分支和 Worktree 等现有用户操作继续保留原终态、取消和重试语义。
4. watcher 正常时，选中目标文件事件在防抖和最小间隔约束内刷新。
5. watcher 不可用时，selected、selected-entry、background 分别使用 15、60、180 秒目标周期，并分散执行。
6. 一个目标同时存在多个刷新信号时，只有一个在途刷新和至多一个尾随刷新。
7. watcher 与 polling 场景下，同状态文件内容变化仍可推进 `contentVersion` 并刷新 Diff。
8. 窗口聚焦不再触发全部陈旧目标同时刷新。
9. 相同后台失败在 5 分钟内只占用一条操作记录。
10. 旧成功和活动 `status` 噪声记录在加载时清理，失败及真实 Git 操作保留。
11. 结构化诊断可以区分请求、合并、执行、变化和失败数量，且不泄露路径或凭据。
12. 定向测试、typecheck、生产构建、差异检查和 Electron 运行验证通过。

## 回滚边界

以下内容构成一个刷新调度边界：

- `WorkspaceRefreshScheduler`；
- `WorkspaceRuntimeService` 的后台刷新接线；
- Main 进程前后台状态接线；
- 后台失败合并；
- 旧 `status` 记录清理；
- 诊断统计；
- 操作中心空状态文案。

该边界可以整体回滚到现有定时器和 `#runStatusRefresh` 实现，不需要迁移 Workspace、Snapshot 或操作文件。由于不提升操作 Schema 版本，回滚后现有操作文档仍可读取。

现有 Git 写操作、确认流程、操作取消、Snapshot Repository、Workspace Repository 和 Renderer 页面结构不属于回滚替换范围。
