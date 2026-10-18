# HotpotQA attribution and modifications

The questions, answers, supporting facts and Wikipedia context in `cases.jsonl`,
`original/hf_records.json` and `original/records.json` are a selected, reformatted
HotpotQA dataset subset licensed under **CC BY-SA 4.0**. Adapted dataset material
remains under that license. The full terms are in
`LICENSE-CC-BY-SA-4.0.txt` and <https://creativecommons.org/licenses/by-sa/4.0/>.

Credit: Zhilin Yang, Peng Qi, Saizheng Zhang, Yoshua Bengio, William W. Cohen,
Ruslan Salakhutdinov and Christopher D. Manning. “HotpotQA: A Dataset for Diverse,
Explainable Multi-hop Question Answering,” EMNLP 2018.
Official project and license statement: <https://hotpotqa.github.io/>.
The dataset contains processed Wikipedia passages; their supplied text and page
titles are preserved. This adaptation does not imply endorsement by the authors.

The official CMU dev JSON endpoint did not download successfully in this session
(HTTPS TLS unexpected EOF; HTTP timeouts). This subset therefore uses the public
`hotpotqa/hotpot_qa` Hugging Face mirror, fixed at
`1908d6afbbead072334abe2965f91bd2709910ab`. Its complete validation parquet SHA256 is
`c20b638ca82b21d04fe12e14ff417ad05153d4d215a65de54497fca4e972f7c6`.
It matches the pinned mirror's LFS metadata. Original CMU JSON byte identity is
**unverified**. The mirror's supplied dataset card and file metadata are retained.

Changes made here: select 48 unique dev distractor problems with seed 17; preserve
mirror rows separately; convert `id` to `_id`, parallel supporting-fact arrays to
ordered pairs and parallel context arrays to ordered pairs; add local tool and
JSON output-format instructions. Questions, answer strings, sentence boundaries,
titles, gold supporting facts and original difficulty labels are not rewritten.
The local citation/read rules are additional evaluation requirements, separate
from official HotpotQA scores. Full transformation details and hashes appear in
every case's provenance and `manifest.json`.

The upstream evaluation code in `vendor/hotpot_evaluate_v1.py` is from
<https://github.com/hotpotqa/hotpot/tree/3635853403a8735609ee997664e1528f4480762a>
and is covered by **Apache License 2.0**, retained in `vendor/LICENSE.txt`.
Copyright 2018 Zhilin Yang, Peng Qi, Saizheng Zhang.
The original upstream file is unmodified. The separately named
`vendor/hotpot_evaluate_v1_stdlib.py` changes only `import ujson as json` to
`import json`. All metric functions and the CLI remain unchanged. The Apache
license does not replace the dataset's CC BY-SA license. Locally authored harness
code follows the containing project's code license.

```bibtex
@inproceedings{yang2018hotpotqa,
  title={{HotpotQA}: A Dataset for Diverse, Explainable Multi-hop Question Answering},
  author={Yang, Zhilin and Qi, Peng and Zhang, Saizheng and Bengio, Yoshua and Cohen, William W. and Salakhutdinov, Ruslan and Manning, Christopher D.},
  booktitle={Conference on Empirical Methods in Natural Language Processing},
  year={2018}
}
```
