#!/usr/bin/env python3
"""Download one checksum-authorized BASiC pilot batch."""

from __future__ import annotations

import argparse, hashlib, json, urllib.parse, urllib.request
from pathlib import Path

RECORD = "https://zenodo.org/api/records/8199999/files/{name}/content"

def checksum(path: Path, algorithm: str) -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""): value.update(chunk)
    return value.hexdigest()

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("proposal",type=Path); parser.add_argument("authorization",type=Path); parser.add_argument("output",type=Path); args=parser.parse_args()
    proposal=json.loads(args.proposal.read_text()); authorization=json.loads(args.authorization.read_text())
    if authorization.get("download_authorized") is not True or authorization.get("training_authorized") is not False: raise SystemExit("authorization must permit download and prohibit training")
    calculated_bytes=sum(item["size"] for item in proposal["candidates"])
    if calculated_bytes != proposal["total_bytes"] or calculated_bytes != authorization["maximum_bytes"]: raise SystemExit("candidate byte sum must exactly match proposal and authorization")
    if proposal["candidate_count"] != authorization["candidate_count"] or proposal["total_bytes"] > authorization["maximum_bytes"]: raise SystemExit("proposal exceeds authorization")
    source_names = {
      "basic-001":"2022-07-26 05-49-12 (No Failure).log", "basic-002":"2022-07-26 06-25-08 (RC Failure).log",
      "basic-003":"2022-07-26 06-46-30 (GPS Failure).log", "basic-004":"2022-07-26 17-02-53 (Accelerometer Failure).log",
      "basic-005":"2022-07-26 18-11-42 (Gyro Failure).log"}
    args.output.mkdir(parents=True,exist_ok=True); receipt=[]
    for item in proposal["candidates"]:
        destination=args.output/item["neutral_filename"]
        if not destination.exists(): urllib.request.urlretrieve(RECORD.format(name=urllib.parse.quote(source_names[item["candidate_id"]],safe="")), destination)
        if destination.stat().st_size != item["size"] or checksum(destination,"md5") != item["upstream_md5"]: raise SystemExit(f"checksum/size mismatch for {item['candidate_id']}")
        receipt.append({"candidate_id":item["candidate_id"],"filename":item["neutral_filename"],"bytes":destination.stat().st_size,"md5":item["upstream_md5"],"sha256":checksum(destination,"sha256")})
    (args.output/"download-receipt.json").write_text(json.dumps({"source_id":proposal["source_id"],"records":receipt},indent=2,sort_keys=True)+"\n")
    print(json.dumps({"downloaded":len(receipt),"bytes":sum(x["bytes"] for x in receipt)},indent=2)); return 0

if __name__=="__main__": raise SystemExit(main())
