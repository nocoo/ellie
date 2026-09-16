"""One immutable Flare image-edit request using Workflow's Azure credentials."""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import struct
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("study", type=Path)
parser.add_argument("--image", action="append", type=Path, required=True)
parser.add_argument("--size", choices=["1536x1024", "1024x1024", "3072x1024"], default="1536x1024")
args = parser.parse_args()
directory = args.study.resolve()
if (directory / "request.json").exists():
    parser.error("An existing request is immutable; use a new directory.")
endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
key = os.environ["AZURE_OPENAI_API_KEY"]
assert endpoint.startswith("https://") and endpoint.endswith("/openai/v1")
prompt = (directory / "prompt.txt").read_text()
fields = {"model": "gpt-image-2.5-flare", "prompt": prompt, "size": args.size,
          "quality": "high", "n": "1", "background": "opaque", "output_format": "png"}
boundary = "ellie-art-" + uuid.uuid4().hex
parts = []
for name, value in fields.items():
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
references = []
for index, path in enumerate(args.image, 1):
    data = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-{index}{path.suffix}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b"\r\n")
    references.append({"index": index, "file": path.name, "sha256": hashlib.sha256(data).hexdigest()})
parts.append(f"--{boundary}--\r\n".encode())
save(directory / "request.json", {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "provider": "Azure OpenAI", "route": "/openai/v1/images/edits",
    "credentialSource": "workflow/.envrc via direnv",
    "parameters": {k: v for k, v in fields.items() if k != "prompt"},
    "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(), "references": references,
})
print(f"Requesting {fields['model']}, {args.size}, {len(references)} references", flush=True)
started = time.monotonic()
try:
    request = Request(endpoint + "/images/edits", data=b"".join(parts), headers={
        "api-key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urlopen(request, timeout=600) as response:
        body = json.loads(response.read())
        request_id = response.headers.get("x-request-id") or response.headers.get("apim-request-id")
    assert len(body.get("data", [])) == 1
    data = base64.b64decode(body["data"][0].pop("b64_json"), validate=True)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    dimensions = struct.unpack(">II", data[16:24])
    (directory / "original.png").write_bytes(data)
    save(directory / "response.json", {"status": "succeeded", "requestId": request_id,
        "elapsedSeconds": round(time.monotonic() - started, 2), "response": body,
        "output": {"file": "original.png", "size": dimensions, "bytes": len(data),
                   "sha256": hashlib.sha256(data).hexdigest(), "nativeBytesPreserved": True}})
    print(f"Saved native {dimensions} PNG: {directory / 'original.png'}", flush=True)
except Exception as error:
    detail = error.read().decode(errors="replace")[:2000] if isinstance(error, HTTPError) else str(error)
    detail = detail.replace(key, "[redacted]").replace(endpoint, "[endpoint]")
    save(directory / "response.json", {"status": "failed" if isinstance(error, HTTPError) else "outcome-unknown",
        "elapsedSeconds": round(time.monotonic() - started, 2), "error": detail})
    raise SystemExit(detail)
