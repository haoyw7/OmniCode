# MonoCode 助理评测

评测程序位于 `host/bots/eval/`。仓库只保留程序、配置、数据清单、选择规则、校验哈希和许可证；案例、参考答案、运行时数据库、原创变体和包含案例内容的报告均保存在项目外。

## 数据准备

评测入口在运行前自动准备所选数据，并逐文件校验 `data/datasets.lock.json` 中的 SHA256。六套公开来源为 `bfcl`、`longmemeval`、`tau_bench`、`api_bank`、`hotpotqa`、`bipia`：首次使用从固定上游版本下载，按现有选择规则重建子集，完整校验后原子写入缓存。缓存有效时可离线复用；下载或校验失败会停止运行，不会改写锁文件。

`original` 需要项目外的原创数据源。默认输入目录是 `${XDG_DATA_HOME:-~/.local/share}/monocode/eval-inputs/original/`，目录内保留以下逻辑路径：

- `data/cases.jsonl`
- `data/references.jsonl`
- `data/variants/structured-nested-v2.jsonl`
- `data/quality-annotations.jsonl`

设置 `MONOCODE_EVAL_ORIGINAL_SOURCE` 可改用项目外的本地目录或由你提供的 HTTPS 基础地址，准备器在该目录或地址下读取锁文件列出的路径。仓库不内嵌案例、不包含原创题目生成脚本，也不提供默认原创数据下载服务。首次准备时缺少输入会报出配置方法；完整缓存已存在时无需再次访问输入源。

| 配置 | 用途与默认位置 |
| --- | --- |
| `MONOCODE_EVAL_ORIGINAL_SOURCE` | 原创输入目录或 HTTPS 基础地址；默认使用上述用户数据目录 |
| `MONOCODE_EVAL_CACHE` | 缓存基目录；默认 `${XDG_CACHE_HOME:-~/.cache}/monocode/eval` |
| `MONOCODE_EVAL_DATA_ROOT` | 指定完整缓存根目录；默认在缓存基目录下追加锁文件 SHA256 的前 16 位 |
| `MONOCODE_EVAL_ARCHIVE_ROOT` | 历史证据归档根目录；默认 `${XDG_DATA_HOME:-~/.local/share}/monocode/eval-archive` |

缓存按 `<缓存根>/<source>/<逻辑路径>` 存储。历史报告中的 `reports/...` 从归档根目录解析；历史证据独立于可重建的数据缓存。缓存、输入和报告目录都应位于项目外。

需要提前准备时，在仓库根目录运行：

```bash
# 只准备所选公开来源。
python3 host/bots/eval/bin/prepare_data.py --sources bfcl,longmemeval

# 读取已配置的外部原创数据源。
python3 host/bots/eval/bin/prepare_data.py --sources original

# 准备 original 和全部六套公开来源。
python3 host/bots/eval/bin/prepare_data.py
```

准备器不会调用模型或安装依赖。Node 入口使用仓库现有的 Node 24、esbuild 和 TypeScript 依赖；Python 入口使用 Python 3.10+。公开桥接器的依赖见 [public/requirements.txt](public/requirements.txt)。首次重建 HotpotQA 额外需要 `pyarrow`（导入器原验证版本 `23.0.1`）；BIPIA 需要 `nltk==3.9.2` 和 `pandas`。这些重建依赖在完整缓存命中时不再需要。

## 验证、列出与参考回放

以下命令不发送模型请求；首次使用仍可能下载公开数据。所有 `--out` 必须指向项目外的新目录，已有报告不会被覆盖。

```bash
# 验证原创案例格式及配套数据。
node host/bots/eval/bin/eval.mjs validate

# 列出所选公开案例。
node host/bots/eval/bin/public_eval.mjs list --sources bfcl,longmemeval

# 校验全部公开来源及程序/数据哈希。
python3 host/bots/eval/bin/verify_public.py

# 参考轨迹回放：验证评测器和数据，不代表模型成绩。
node host/bots/eval/bin/eval.mjs run --mode reference --out /tmp/monocode-reference-NEW
node host/bots/eval/bin/public_eval.mjs run --mode reference --sources bfcl --out /tmp/monocode-public-reference-NEW
```

单元测试读取已准备的数据缓存；只运行与改动相关的测试。更新数据时，在项目外维护输入，审阅选择规则和产物后同步数据锁；普通评测不能自动接受上游内容变化。

真实推理仍受外部归档中既有的暂停条件、费用硬门禁和累计账本约束；数据迁移不会恢复真实请求、清零预算或重新授予调用模型的许可。

## 报告与历史证据

新运行的报告保存在显式的外部 `--out` 目录；使用默认输出位置的入口写入用户归档目录。报告包括 `results.jsonl`、`summary.json`、`report.md`，部分入口还写入选择与哈希清单。参考回放、真实模型结果、环境错误和预算中断分别记录，不能把参考答案回放或格式校验算作模型成功。

历史报告和原始说明已归档到 `MONOCODE_EVAL_ARCHIVE_ROOT`。历史汇总与重评分需要该归档中的原始证据；缺失证据时应配置正确的归档根目录，不能从新运行结果补造旧证据。历史预算、暂停条件、校准状态及原始文件哈希保持其原有意义。

## 程序、清单与许可

- `src/`、`native/`、`bin/`：评测运行器、Host 接入、数据准备及报告工具。
- `schema/`、`tests/`：数据契约与相关回归检查。
- [data/datasets.lock.json](data/datasets.lock.json)：外置数据的逻辑路径和 SHA256。
- [data/sources.json](data/sources.json)、[data/license-audit.json](data/license-audit.json)：来源、固定版本与许可记录。
- [public/README.md](public/README.md)、[public/ADAPTER_CONTRACT.md](public/ADAPTER_CONTRACT.md)：六套公开适配器的范围、计分方式和扩展契约。
- `public/<source>/`：适配器、确定性导入程序、元信息和原有许可证声明。

公开子集是本地评测适配，不能直接宣称官方榜单成绩。代码与数据许可分别记录，各来源的许可证和限制继续适用。
