# Eval relocation / 目录迁移（2026-10-09）

The canonical program/configuration location is `host/bots/eval/` at repository root. The former root-level `eval/` directory was moved in place; no compatibility copy or symlink is retained. Dataset payloads and historical reports now live outside the checkout.

原路径 `/projects/monocode/eval/` 现对应 `/projects/monocode/host/bots/eval/`。历史 reports、PROGRESS、RESULTS、IMPLEMENTATION 中的命令、绝对路径和当时的 Git 状态按原样保留，它们记录的是当时环境，不能直接当作当前命令。历史相对路径仍以 eval 根目录为基准。目录名中的 2026-10-10 仍是既有笔误；真实运行时间请看 manifest 的 UTC 时间。

首次目录迁移前有 **825 个文件（736 个 Git 跟踪文件）**，其中 **173 个历史 reports 文件**。该次迁移的清单和比对原件保留在外部归档的 `reports/migration-2026-10-09/before.json` 与 `integrity.json`。Python cache 不作为数据集分母。

## External storage

可下载的数据按 `data/datasets.lock.json` 固定版本与哈希准备到项目外缓存；当前源配置及准备命令见 [README](../README.md)。原创题库也作为外部数据源处理，源码目录不再保存题目生成器或案例变体正文。

历史原件的默认归档目录为 `${XDG_DATA_HOME:-~/.local/share}/monocode/eval-archive/`，可用 `MONOCODE_EVAL_ARCHIVE_ROOT` 覆盖。归档保留原来的相对布局，例如 `reports/pi-breadth-2026-10-09/`、`docs/RESULTS.md`。`data/archive-manifest.json` 记录迁出文件与哈希。历史报告和日志保持原字节；其中的旧路径表示逻辑来源，不表示文件仍在项目里。

只运行新评测不需要历史归档。复查历史评分时，将归档复制到上述目录，或设置 `MONOCODE_EVAL_ARCHIVE_ROOT` 指向包含 `reports/` 的目录。缺少归档时历史汇总明确报错，历史回归测试跳过；普通评测不会把缺失的旧证据提升为已校准。源码内不再生成报告；新输出使用项目外的新目录。

Path repairs cover the native product imports, fixture tests, public implementation hash paths, Python CLI working directories, Vitest root, and active documentation. Host test/typecheck configuration excludes this independent eval tree so normal Host work keeps its previous scope. No assistant production behavior changed.

Current integrity locks describe program/configuration files and external payloads at their logical paths. They were refreshed for the data separation; historical manifests intentionally retain their original implementation/lock hashes.

## Commands from repository root

```bash
node host/bots/eval/bin/eval.mjs validate
python3 host/bots/eval/bin/verify_public.py
node host/bots/eval/bin/eval.mjs run --mode reference --out /tmp/original-reference-NEW
node host/bots/eval/bin/public_eval.mjs run --mode reference --max-steps 32 --out /tmp/public-reference-NEW
node_modules/.bin/vitest run --config host/bots/eval/vitest.config.ts
python3 -m unittest discover -s host/bots/eval/tests -p 'test_*.py'
node_modules/.bin/tsc --noEmit -p host/bots/eval/tsconfig.json
python3 host/bots/eval/bin/scoring_report.py --out /tmp/assistant-scores-NEW
```

## Commands from eval directory

```bash
cd host/bots/eval
node bin/eval.mjs validate
node bin/public_eval.mjs list
../../../node_modules/.bin/vitest run --config vitest.config.ts
python3 -m unittest discover -s tests -p 'test_*.py'
../../../node_modules/.bin/tsc --noEmit -p tsconfig.json
python3 bin/scoring_report.py --out /tmp/assistant-scores-NEW
```

Use a fresh output directory outside the project each time. The commands above make no model requests; preparing an uncached external source requires network access. Dataset tests use prepared caches and skip when absent. The scoring report reads archived real Pi evidence and requires the historical archive; reference results and unit tests remain framework checks. The original migration verification is preserved at archive path `reports/migration-2026-10-09/verification.json`.
