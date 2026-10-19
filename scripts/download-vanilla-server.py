#!/usr/bin/env python3
"""Download an official, pinned Mojang vanilla server without redistributing its jar.

Usage: python3 scripts/download-vanilla-server.py --version 1.20.1 --output /tmp/server.jar
Uses only Python's standard library. Aborts on any version, digest or size mismatch.
"""
import argparse
import hashlib
import json
import os
import pathlib
import tempfile
import urllib.request

MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
PINNED_SHA1_1201 = "84194a2f286ef7c14ed7ce0090dba59902951553"

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "minecraft-mbot-repro/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def download(version, output, expected_sha1):
    manifest = fetch_json(MANIFEST_URL)
    matches = [record for record in manifest["versions"] if record["id"] == version and record["type"] == "release"]
    if len(matches) != 1:
        raise ValueError("Official Mojang release not found: " + version)
    metadata = fetch_json(matches[0]["url"])
    if metadata.get("id") != version:
        raise ValueError("Version metadata does not match requested version")
    data = metadata["downloads"]["server"]
    if data["sha1"].lower() != expected_sha1.lower():
        raise ValueError("Official version SHA-1 differs from pinned expected SHA-1")
    url = data["url"]
    if not url.startswith("https://piston-data.mojang.com/"):
        raise ValueError("Unexpected server download host")
    output = pathlib.Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output.parent, delete=False) as tmp:
            temp_name = tmp.name
            digest = hashlib.sha1()
            size = 0
            req = urllib.request.Request(url, headers={"User-Agent": "minecraft-mbot-repro/1.0"})
            with urllib.request.urlopen(req, timeout=120) as response:
                while chunk := response.read(1024 * 1024):
                    tmp.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
        if digest.hexdigest() != expected_sha1.lower():
            raise ValueError("Downloaded server SHA-1 mismatch")
        if size != data["size"]:
            raise ValueError("Downloaded server size mismatch")
        os.replace(temp_name, output)
        print(json.dumps({"version": version, "size": size, "sha1": digest.hexdigest(), "output": str(output)}))
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="1.20.1")
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha1", default=PINNED_SHA1_1201)
    args = parser.parse_args()
    download(args.version, args.output, args.expected_sha1)
