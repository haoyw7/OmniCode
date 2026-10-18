#!/usr/bin/env python3
"""Offline campaign summary using the same calibration gate as the live runner. No model calls."""
import argparse, subprocess
from pathlib import Path
from eval_data import require_external_output, resolve_data_file
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    if args.out.exists():raise SystemExit('Output must be new')
    require_external_output(args.out)
    campaign=resolve_data_file(args.campaign)
    if not campaign.is_dir():raise SystemExit('Campaign is unavailable; set MONOCODE_EVAL_ARCHIVE_ROOT or pass an existing archive directory')
    subprocess.run(['node',str(ROOT/'bin/eval.mjs'),'replay','--campaign',str(campaign),'--out',str(args.out.resolve())],cwd=ROOT.parents[2],check=True)
if __name__=='__main__':main()
