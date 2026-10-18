# Source and adaptation notice

API-Bank is by Minghao Li, Yingxiu Zhao, Bowen Yu, Feifan Song, Hangyu Li, Haiyang Yu, Zhoujun Li, Fei Huang, and Yongbin Li. The original project and data sources are identified in `README.md` and `manifest.json`.

| Material | Source and license evidence |
| --- | --- |
| `raw/level-1-api.json`, `raw/level-2-api.json`, derived selected cases | Publisher HF dataset revision `12e8158b7628c168f07e8f31fbbe3445e99f44cf`; exact bundled card declares `license: mit`. |
| `raw/dialogues/*.jsonl` structured companion annotations | Official Git revision `f30ccf22b4e2617fab32958d4c03f5c1f2e7dfcf`; official README identifies these and HF test-data as the same conversation data. All 399 level-1 target calls are exactly mapped in `raw/data_mapping.json`. Data-license correspondence relies on the HF MIT designation and official cross-reference, not on the code license. |
| `vendor/`, `raw/upstream_code/`, `fixtures/` | Official repository's Apache-2.0 license, copied verbatim as `LICENSE-CODE-APACHE-2.0.txt`. Fixtures are repository-shipped executable mock environment state. |

The HF card contains only the MIT metadata declaration, with no separate full MIT license text or copyright notice. We retain that evidence verbatim rather than inventing a copyright holder or presenting the code license as independent data-license evidence. The structured repository annotations have no separate data-specific license file; the above publisher correspondence is the available licensing evidence. Any release policy requiring a separate signed data grant should treat that evidence limitation explicitly.

Local changes: static tool registry and fresh isolated constructor; package-relative API imports; removal of unused persistence helpers; standard JSON schema and transport bridge; strict action/type/size limits; arithmetic parser guard; prior-observation replay; source-specific state/trace/final checks. Original native checker and tool implementation bodies are preserved. `vendor_audit.json` lists hashes and file-level changes. The original code is not loaded through its upstream package initializer, which would import unselected plugins.

No connection is made to the synthetic fixture accounts, passwords, contacts, websites or health records. No upstream LLM wrapper or embedding model is imported. No agent score or official full-suite score is implied by the reference validation.
