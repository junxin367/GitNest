# 代码分析对被分析项目的写入边界

## 已确认的问题

GitNest 向 JDT LS 传入真实项目目录，却未在 initialize 阶段关闭自动构建。
拒绝 workspace/applyEdit 只约束协议编辑，无法阻止子进程自行写磁盘。
独立 -data 隔离 Eclipse 工作区数据，不会改变导入工程的编译输出位置。
复用编辑器的 JDT LS 启动逻辑也未加载编辑器随附的 Lombok agent。

本机 GitNest 的 JDT LS 日志在 2026-10-09 14:20:54 记录了
JavaBuilder / AutoBuildJob 向被分析工程 target/classes 复制资源时的冲突。
该证据确认自动构建及写入尝试；不能据此逐个归因此前发现的全部坏 class。

## 修复

- Java 在 initialize、didChangeConfiguration、workspace/configuration 三条配置路径中保持自动构建关闭。
- 禁用 Maven、Gradle、Eclipse 工程导入。仅关闭自动构建不够：真实 Maven 验证仍观察到 target/test-classes 被创建。
- 禁止在项目根目录生成 Eclipse 元数据。使用新的 GitNest 托管工作区命名空间，避免复用旧导入工程；自定义 -data 会明确报错。
- 编辑器 JDT LS 启动时加载随扩展提供的最新 Lombok jar，agent 参数位于 -jar 前。
- Java 保留文档级增强，明确标记语义覆盖不完整，并提示构建依赖语义受限。
- Rust 关闭保存检查、构建脚本和过程宏；Cargo 使用 --frozen，输出目录设置到 GitNest 运行时目录，禁止隐式联网。
- Go 设置 -mod=readonly，限制模块文件自动调整；这不是对所有文件的操作系统级禁写保证。
- TypeScript 关闭自动类型包获取。
- Kotlin、C# 的工程导入可能运行 Gradle / MSBuild 或依赖还原，尚无经过验证的项目写入隔离方案，因此阻止外部服务启动并明确降级。关闭内置降级时仍按原逻辑报告分析失败。
- 分析过程中发现语言已禁用或没有对应文件时，关闭文档并释放会话；取消分析时不再让该会话继续闲置。该行为不表示设置保存动作本身会向所有空闲进程即时广播。
- 分析索引和快照配置键包含策略版本，旧语义覆盖结果不再被当作当前策略下的完整结果。

## 其他路径检查

| 路径 | 结果 |
| --- | --- |
| 内置源码发现、读取、语法解析 | 使用只读文件接口，未发现编译或改写源码调用 |
| 分析缓存、语言服务安装目录 | 桌面入口使用应用数据注册表的专用目录 |
| Git 只读查询 | 已使用 GIT_OPTIONAL_LOCKS=0 |
| Python / Vue 默认分析路径 | 未发现 GitNest 主动执行构建、格式化或依赖安装；不等同于验证任意插件或自定义服务器的行为 |
| workspace/applyEdit | 继续拒绝项目编辑 |
| 第三方 / 用户自定义语言服务 | 配置不能替代操作系统沙箱，恶意或不遵守配置的进程仍有当前用户权限 |

## 验证证据

真实 JDT LS：本机 Red Hat Java 扩展 1.54.0 中的 JDT LS 1.58.0-SNAPSHOT，
日志记录的提交为 7be965c。

临时工程同时包含 Maven pom、Eclipse .project/.classpath、会直接抛错的
Gradle 构建脚本、存在类型错误的 Java 源码，以及 target/classes 中的已有 class 哨兵文件。
分别执行首次分析和会话复用分析，比较工程目录清单、所有文件 SHA-256 和修改时间。
修复后的两轮均连接成功，返回文档符号；项目文件和目录均未变化。
日志未发现 AutoBuildJob、JavaBuilder、Maven/Gradle 导入或 Gradle 脚本执行。

本地证据保存在忽略目录：

- `temp/lsp-readonly-audit/1791527737520/result.json`：只关自动构建时，额外创建 target/test-classes 的反例。
- `temp/lsp-readonly-audit/1791528196487/result.json`：最终策略下项目未变化的结果。
- 同目录 runtime 保留实际 JDT LS 日志。
- `temp/lsp-readonly-audit/real-jdt-smoke.test.ts`：临时验证程序备份；需要放回原 src 目录后按 Vitest 用例执行。未作为依赖本机 Java 扩展的永久测试纳入 CI。

已有测试覆盖初始化顺序、后续配置响应、Lombok jar 选择和 JVM 参数顺序、
被阻止的导入器不会启动、自定义 Java 工作区拒绝、关闭会话及旧缓存失效。

最终验证：全量 137 个测试文件、2209 项测试通过；最后一次会话清理调整后的
75 项相关回归通过。全项目类型检查、架构检查、生产构建和 diff 空白检查通过。

本机未安装可运行的 rust-analyzer 或 gopls，Rust / Go 验证范围为配置和协议测试，
未声称完成这两个真实语言服务的文件系统验收。

## 适用边界

本次没有修改被分析仓库的 pom、IDE 设置、源码或编译输出，也没有清理用户现有坏 class。
已经运行的旧 GitNest / JDT LS 需要退出后加载修复；代码修改不会追溯改变旧进程的启动策略。
以后若恢复构建系统导入，应先实现并验证独立项目副本或文件系统隔离，不能只撤掉禁用开关。
