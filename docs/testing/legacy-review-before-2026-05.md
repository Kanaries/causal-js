# 2026 年 5 月前代码与测试评审

**建议优先修复默认 PC Worker、稳定性分析的边方向，以及显式调整集的可观测性校验。** 共复现 11 个实现问题。两个独立的 Worker 故障分别涉及打包和 CommonJS 路径解析，修复其中一个仍不足以恢复两个入口。

## 范围与验证

以 2026-05-01 零点（洛杉矶时间）为界，最后一个历史提交为 `694f513`（4 月 6 日）。按当时的文件树盘点了 7 个包、54 个包内 TypeScript/Rust 非测试源文件和 28 个测试文件。54 个源文件按 core、discovery、tasks、kernel、node、web、causal 分别为 10、15、10、2、5、5、7 个。沿这些模块的当前调用链核查，并将 5 月后新增的回归用例计入现有防护。下列问题在以 `b2a9aca` 为 HEAD、包含评审开始时已有本地改动的工作区复现。范围盘点覆盖七个包，反例集中在发现算法、任务汇总、图语义及发布入口。

| 核验 | 结果 |
| --- | --- |
| 4 月快照，在临时目录运行当时的默认单测 | 27 个文件，123 项通过 |
| 当前工作区，构建、包类型检查、示例类型检查 | 全部通过 |
| 当前工作区，单测 / 集成 / Python 验收 | 451 / 21 / 25 项通过 |
| 外部 `causal-parity` 本地检出 `4926c41`，按 CI 的 Vitest 命令指向当前源码 | 10 个文件，46 项通过 |
| 当前 npm tarball，仓库外离线安装，用普通 Node 文件加载默认 Worker | ESM 线程无响应，CommonJS 路径不存在 |
| 独立图转换核验 | 穷举 4 个有标签节点的 543 个 DAG，按骨架和无屏蔽碰撞结构分为 185 个等价类。逐边计算等价类中被迫的方向，`dagToCpdag` 全部吻合。`pdagToDag` 给出的扩展全部属于原等价类。 |

运行环境为 Node 24.14.0。Python 验收使用已有、含 NumPy/SciPy 和 StatsPAI 的本地环境。浏览器 Worker 核验到 tarball 内的产物，实际线程测试使用 Node。外部测试的数字覆盖 CI 所用回归集，未执行另行生成历史基准的全量流程。

## P1 · 建议优先修复

| 问题与定位 | 可复现的影响 | 修复与回归断言 |
| --- | --- | --- |
| **1. 发布包的 Worker 入口丢失注册逻辑。** [Node 入口](../../packages/causal/src/node/workers/pc-worker-runtime.ts)、[Web 入口](../../packages/causal/src/web/workers/pc-worker-runtime.ts) 只转出依赖模块，该模块依靠加载时的副作用注册消息处理器。 | 本次打包后，Node 和 Web 的 ESM runtime 文件均为 **0 字节**。从仓库外的 `.mjs` 文件调用公开的默认 Node 适配器，真实线程以 0 退出，任务 Promise 仍未完成。现有[集成测试](../../tests/node-worker.integration.test.ts)指定内部 `packages/node/dist` 的绝对路径，跳过公开包的构建产物。 | 让公开入口显式注册处理器，并确保打包保留这一调用。用安装后的 tarball 从公开 API 启动默认 Worker，以有限等待时间断言返回预期边和端点。Web 构建也应验证能收到回复。 |
| **2. 普通 CommonJS 文件解析出消费者目录下的源码路径。** [Node 适配器](../../packages/node/src/adapters/pc-worker.ts)，`getCommonJsModuleUrl` 和 `getDefaultPcNodeWorkerEntry`。 | 在独立 `.cjs` 文件里 `require('@kanaries/causal/node')`，动态 `Function` 取不到模块局部的 `require`，回退到当前目录。实际尝试加载 `<消费者目录>/packages/node/src/adapters/workers/pc-worker-runtime.js` 并报 `Cannot find module`。现有测试只匹配路径中的文件名。 | 在构建产物中用模块自身的位置解析资源。在仓库外分别用真正的 `.cjs` 和 `.mjs` 文件执行同一任务，断言两者均完成。 |
| **3. 稳定性分析可以反转确定方向的边。** [稳定性汇总](../../packages/tasks/src/stability.ts)，`orientationCounts`。 | 两列按 `['Z','A']` 排列，CI 保留邻接，背景知识要求 `Z → A`。只运行一次全样本重采样，直接 PC 返回 `Z → A`，共识图返回 **`A → Z`**。代码按字典序保存端点，又把它们绑定到原始列序的节点。现有[共识图用例](../../packages/tasks/src/tasks.test.ts)使用顺序标签和无向边。 | 每条记录从同一个排序后的节点对读取节点 ID 和对应端点。测试同一有向图的两种列序，并按节点名同时比较单次发现图、方向频率表和共识图。 |
| **4. 显式提交的潜变量被认证为可用调整集。** [调整集判定](../../packages/tasks/src/adjustment.ts)，`evaluateAdjustmentSet`。 | 图为 `U → X`、`U → Y`、`X → Y`，其中 `U` 标为 latent。`findAdjustmentSets(X,Y)` 返回零个可用集合，但 `isAdjustmentSet(X,Y,['U'])` 返回 `valid: true` 并建议选择估计器。数学上条件化 U 能阻断后门，观测数据却无法提供 U。现有潜变量用例主要验证枚举时的过滤。 | 两个入口共用 measured 协变量资格检查，对 latent、selection 给出可区分的原因。补上 `U` 分别为 latent、selection、measured 的成对测试，检查返回的有效性和下一步建议。 |

## P2 · 其余已复现问题

| 问题与定位 | 可复现的影响 | 修复与回归断言 |
| --- | --- | --- |
| **5. 稳定性分析遗漏 CD-NOD 的上下文节点。** [节点清单来源](../../packages/tasks/src/stability.ts)，`nodeIds`。 | 两列观测数据加上下文 C，直接结果包含 `C → X1` 和 `C → X2`。一次重采样的运行摘要有三条边，但共识图只保留 X1、X2 及其间的一条边。汇总只枚举原始数据列。 | 从每次返回的发现图取得节点和类型。对于 CD-NOD 这样的固定节点集，一次全样本运行必须保留每条上下文边。对跨次不一致的节点集，要明确匹配规则或报告无法汇总。 |
| **6. GES 可以越过显式的父节点数上限。** [GES 插入候选](../../packages/discovery/src/ges.ts)，`ges`、`scoreDeltaForAdd`。 | 用 50 行 `[i, i + sin(i)]`、Gaussian BIC 和 `maxParents: 0` 仍加入一条边。代码只在插入前的有向父节点数已经大于上限时跳过，也未把候选子集计入限制。现有 GES 用例覆盖插入和删除，但没有卡住这一边界。 | 用插入后的候选父集检查上限。测试上限 0 必须得空图，上限 1 时加入会产生两个父节点的候选必须被排除。 |
| **7. PC 稳定骨架会记录未经 CI 支持的空分离集。** [PC 骨架](../../packages/discovery/src/pc.ts)，`collectedSepsets` 的空数组回退。 | 对 DAG `B → A, C → A, C → B, D → B` 使用精确 d-separation 判别器，A 与 D 返回的分离集为 `[[B,C], []]`。同一判别器对空集返回 0（连通），对 `[B,C]` 返回 1。边已从另一方向标记删除，反向扫描没有找到新分离集时仍写入了空集。 | 把待删除标记与独立性证据分别记录，只写入实际通过的条件集。让测试重新用精确判别器验证每个返回的分离集，包括反向扫描结果。 |
| **8. DAG 独立性测试接受无向边并将相邻节点判为独立。** [DSeparationTest](../../packages/core/src/ci.ts) 构造函数只检查有向环。 | 对只有一条 `A — B` 的 CPDAG，`new DSeparationTest(graph).test(0,1)` 返回 1。遍历只读取父子关系，这条边被忽略。用它作为 PC 的判别器会把直接邻接当成可删边。现有核验器生成的输入都是 DAG。 | 构造时核对所有边均为有向边并验证无环，与 DAG kernel 对齐。测试无向、双向、部分定向边均被拒绝，保留合法 DAG 正例。 |
| **9. Node Worker 正常提前退出时任务不会结束。** [消息桥](../../packages/node/src/worker-bridge.ts)，`runTask`。 | 启动一个不回复消息就自然退出的真实 Worker，退出后任务仍 pending。桥只监听 message 和 error。即使修好发布包，调用者自定义的 Worker 仍可触发此问题。 | 监听 exit，只要尚未收到任务回复就 reject。单次结算并清理监听器，测试「先退出」和「先回复、再退出」两种顺序。 |
| **10. 带分隔符的合法节点名会合并不同节点对。** [稳定性键](../../packages/tasks/src/common.ts)与[独立性约束去重键](../../packages/tasks/src/falsify.ts)。 | 标签 `A, B::C, A::B, C` 有六个无序对。一次全相连的 PC 重采样只报告五对，其中一对邻接频率为 **2**。对同名的四节点空 DAG，`falsifyGraph` 只生成五条边际独立性约束，漏检一条。 | 用结构化元组编码节点对和条件集。测试四节点恰有六对，每对频率总和为 1，空 DAG 的六条不同约束逐条出现。 |
| **11. 背景知识的显式边规则在序列化时改变含义。** [规则键与解析](../../packages/core/src/background-knowledge.ts)，`makeEdgeKey`、`parseEdgeKey`。 | 添加 `addForbidden('A->B','C')` 后，`isForbidden('A','B->C')` 也为真。`toShape()` 把原规则写成 `{from:'A',to:'B'}`。通过 Worker 传输规则会改变被约束的边。现有往返测试使用普通标签。 | 用结构化有向节点对存储。对 forbidden 和 required 均测试含 `->` 的两个不同节点对，验证原始、往返、传入 Worker 后的判定。 |

## 哪些错误能通过现有测试

在独立的 `b2a9aca` 副本中做了两处故障注入，随后运行了该副本的整个默认单测集。**57 个文件、451 项全部通过**。没有改写工作区的源码或测试。

1. **清空可序列化 PC Worker 的全部输出边。** 保留节点和统计量，强制返回 `graph.edges = []`。[Worker 单测](../../packages/discovery/src/pc-worker.test.ts)只核对节点数和非负深度，Node/Web 的 handler 测试核对成功消息，三者均通过。当前真实线程集成测试用同一个执行函数生成期望值，适合检查传输一致性。另需一个手写预期的有向碰撞图，经完整 Worker 链路断言每条边、端点和缺失边。
2. **使 Rust 函数对所有合法查询都返回“分离”。** 保留仓库中原有的预编译 WASM，两个 kernel 测试文件内的四项测试全通过。[常规构建](../../packages/kernel/scripts/build.mjs)复制已提交的 WASM。修改 Rust 源码不会改变这些测试运行的字节。建议在 Rust 或构建脚本变更时，从当前源码编译 WASM 并对新产物运行现有的独立路径枚举测试，再验证交付的二进制。

[production-integrity 测试](../../tests/production-integrity.test.ts)检查固定文件名单及占位词，名单漏掉了 4 月已有的 FCI、Graph IR 和 tasks。它可以作为文本检查保留。衡量算法正确性时，更值得复用已有的[小图穷举最优分数](../../packages/discovery/src/exact-search.test.ts)、[独立路径枚举](../../packages/kernel/src/dsep-crosscheck.test.ts)和 FCI 的端点矩阵断言。优先把这些独立预期放到上面能复现错误的输入和发布入口上。
