#!/usr/bin/env python3
"""Run the frozen representative selection in one shared request/USD budget."""
import argparse
import json
from pathlib import Path
import subprocess
from eval_data import require_external_output

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--mode", choices=("reference", "pi"), default="reference")
parser.add_argument("--out", required=True)
args = parser.parse_args()
require_external_output(args.out)
selection = json.loads((root / "public/smoke-selection.json").read_text())
command = ["node", str(root / "bin/public_eval.mjs"), "run", "--mode", args.mode,
           "--ids", ",".join(case["id"] for case in selection["cases"]),
           "--seed", str(selection["seed"]), "--model", selection["model"],
           "--max-requests", str(selection["maxRequests"]), "--max-usd", str(selection["maxUsd"]),
           "--max-steps", "32", "--out", str(Path(args.out).resolve())]
raise SystemExit(subprocess.run(command, cwd=root.parents[2], check=False).returncode)
