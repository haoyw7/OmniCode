# 可执行 HotpotQA dev distractor 子集

48 道独立原题，bridge/comparison 各 24 道，保留 480 段 context、1,933 个原句和
117 条 gold supporting facts；答案包含 38 个文本答案、10 个 yes/no。
这是**离线 distractor 证据阅读与多跳推理**适配，不是 fullwiki 检索、实时网页研究，
也不是完整官方 benchmark。原始 dev 镜像的 7,405 题全部是 `level=hard`，无法从这个
split 构造 easy/medium 分层；本实现保留该限制，不虚构难度标签。

在工作区根目录执行，无网络、凭据、模型或额外运行依赖：

```bash
python3 host/bots/eval/public/hotpotqa/adapter.py reference
python3 -m unittest discover -s host/bots/eval/tests -p 'test_public_hotpotqa.py' -v
# 可选：保存新报告，已有文件不会被覆盖。
python3 host/bots/eval/public/hotpotqa/adapter.py reference --out /tmp/hotpotqa-reference-new.json
```

`reference-validation.json` 记录 48/48 参考轨迹通过，模型请求为 0。
**这是 harness 自测，不是实际 agent 成绩。** 12 项单元测试覆盖全部参考轨迹、
无 gold 泄漏、完整原句读取、官方评分 parity、错误答案、伪造/越界/布尔索引引用、
未读来源、伪造 trace、Episode 重置隔离、返回对象隔离、格式与未知动作拒绝，
以及镜像转换、确定性抽样、逐文件哈希。

## 接口与评分

`adapter.py` 遵循 `../ADAPTER_CONTRACT.md` 的 `load_cases()` 和 `Episode` 接口。
`load_cases()` 含私有 gold 和 provenance，仅给评分端使用；只将 `start()` 返回值送入
agent。`start()` 提供原问题、未标注的十个标题、局部工具说明和最终输出要求，
绝不加入答案、gold support 标签、题型/难度、reference 或未来 tool 消息。

- `search_passages(query, limit=5)`：仅对本题十段做确定性词项匹配，返回标题和首句预览。
- `read_passage(title)`：返回该标题的全部原句及原始零基索引，记录本 Episode 已读来源。
- 最终输出：`{"answer":"...","supporting_facts":[["Exact title",0]]}`。

`metrics.official` 原样使用固定官方 evaluator 的 answer EM/F1/precision/recall、
support EM/F1/precision/recall 和 joint 四指标。所有分值在 0–1 范围内；joint 计算
复用官方公式。官方 `ujson` 仅替换为标准库 `json`，原文件另存且哈希锁定。
测试把 adapter 四组正确/错误/部分答案的十二指标与完整 vendored CLI 逐项比对。

`checks` 与 `metrics.local` 单独表示本地 JSON 格式、真实存在的引用标题/句索引、
无重复引用、已实际读取且 trace 结果一致。最终 `passed` 要求全部本地检查通过，
同时官方 answer/support/joint EM 为 1。即便给出完美 gold，未读来源也失败；此时
官方分数仍为 1，不把本地硬检查冒充官方指标。格式错误没有可评分预测，返回 0。
这里不使用 LLM judge，也不更改公共 runner 的 judge 信任门槛。

## 来源、选择与重建

官方数据入口 <https://hotpotqa.github.io/> 声明 CC-BY-SA 4.0。
CMU 官方 JSON 下载的 HTTPS TLS 失败，HTTP 超时；因此使用固定公开 HF 镜像：

- 数据 revision：`1908d6afbbead072334abe2965f91bd2709910ab`。
- 文件：`distractor/validation-00000-of-00001.parquet`，27,452,575 字节。
- SHA256：`c20b638ca82b21d04fe12e14ff417ad05153d4d215a65de54497fca4e972f7c6`，与固定 HF LFS 元数据一致。
- 评分代码 revision：`3635853403a8735609ee997664e1528f4480762a`；版权及 Apache-2.0 完整保留。

没有验证镜像与 CMU 原 JSON 的字节一致性。`original/hf_records.json` 保存镜像原行；
`original/records.json` 保存确定性字段还原后的原题形式；`cases.jsonl` 将其嵌入私有
`data` 并增加适配 metadata。具体还原规则和双重 record SHA256 写在每题 provenance。

先按 ID、规范化行 SHA256 和不含 ID 的内容 SHA256 去重（此源未发现重复）；再排除
60 道 context 不足十个独立标题的题和 1 道 gold 句索引无效的题。全部 61 个排除 ID
及原因保留在 manifest。按 type/level 分层，排序后使用 `random.Random(17).sample`
分别抽 24 题。剩余可选原题是 bridge/hard 5,898、comparison/hard 1,446。

只在需要重新导入时使用 pyarrow；该包不参与 runtime，不安装模型框架：

```bash
curl -fL 'https://huggingface.co/datasets/hotpotqa/hotpot_qa/resolve/1908d6afbbead072334abe2965f91bd2709910ab/distractor/validation-00000-of-00001.parquet' -o /tmp/hotpot_distractor_validation.parquet
python3 -m pip install --only-binary=:all: --no-deps --target /tmp/hotpot-import-deps pyarrow==23.0.1
PYTHONPATH=/tmp/hotpot-import-deps python3 host/bots/eval/public/hotpotqa/import_subset.py --parquet /tmp/hotpot_distractor_validation.parquet
```

导入器首先检查完整文件 SHA256；不匹配则拒绝导入。它会重建本目录的选题文件和
manifest，请在修改手工数据之前保留副本。完整 parquet 不放入仓库，只保留实际运行
所需的 48 道原题。许可、作者署名和改动声明见 [NOTICE.md](NOTICE.md)。
