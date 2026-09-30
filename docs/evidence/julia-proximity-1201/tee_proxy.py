#!/usr/bin/env python3
"""Proxy de gravação: repassa POST /choose ao sidecar (8768) e grava request/response em JSONL."""
import json, time, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = '/tmp/run/julia-payloads.jsonl'; lock = threading.Lock()
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        t0 = time.time()
        try:
            req = urllib.request.Request('http://127.0.0.1:8768' + self.path, data=body, headers={'content-type': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r: status, out = r.status, r.read()
        except urllib.error.HTTPError as e: status, out = e.code, e.read()
        except Exception as e: status, out = 502, json.dumps({'error': str(e)}).encode()
        with lock:
            with open(LOG, 'a') as f:
                try: rq = json.loads(body)
                except Exception: rq = None
                try: rs = json.loads(out)
                except Exception: rs = None
                f.write(json.dumps({'ts': time.time(), 'status': status, 'proxy_ms': round((time.time()-t0)*1000), 'request': rq, 'response': rs}) + '\n')
        self.send_response(status); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(out))); self.end_headers(); self.wfile.write(out)
    def do_GET(self):
        with urllib.request.urlopen('http://127.0.0.1:8768' + self.path, timeout=10) as r: out = r.read()
        self.send_response(200); self.send_header('content-length', str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8769), H).serve_forever()
