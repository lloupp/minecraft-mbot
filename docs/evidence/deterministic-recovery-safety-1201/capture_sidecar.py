"""Test-only recorder around the unchanged production sidecar and real engine."""
import hashlib
import importlib.util
import json
import os
import pathlib
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(os.environ.get('ORDER_OUTPUT_DIR', str(HERE)))
spec = importlib.util.spec_from_file_location('sidecar', HERE.parents[2] / 'scripts/julia-decision-server.py')
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
local = threading.local()
original_choose = sidecar.choose


class CaptureEngine:
    def __init__(self, real):
        self.real = real

    def predict(self, **kwargs):
        # Capture exactly at the real predict boundary, preserving criteria order.
        local.row['engine_predict_calls'] += 1
        encoded = json.dumps(kwargs, ensure_ascii=False, separators=(',', ':'))
        local.row['normalized_payload'] = kwargs
        local.row['normalized_order'] = list(kwargs['questions']['intent']['criteria'])
        local.row['normalized_sha256'] = hashlib.sha256(encoded.encode()).hexdigest()
        result = self.real.predict(**kwargs)
        local.row['raw_julia_output'] = result
        return result


def capture_choose(payload):
    row = {'trace_id': payload.get('trace_id'), 'request': payload,
           'received_order': [c['id'] for c in payload['candidates']],
           'started_at': time.time(), 'error': None, 'engine_predict_calls': 0,
           'normalized_candidates': sidecar.normalize_candidates(payload['candidates'])}
    local.row = row
    started = time.perf_counter()
    try:
        result = original_choose(payload)
        row['response'] = result
        return result
    except Exception as exc:
        row['error'] = {'type': type(exc).__name__, 'detail': str(exc)}
        raise
    finally:
        row['wall_latency_ms'] = (time.perf_counter() - started) * 1000
        with (OUT / 'sidecar-traces.jsonl').open('a') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    import platform
    import torch
    import transformers
    torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '2')))
    sidecar.load()
    sidecar.engine = CaptureEngine(sidecar.engine)
    sidecar.choose = capture_choose
    (OUT / 'runtime-environment.json').write_text(json.dumps({
        'python': platform.python_version(), 'torch': torch.__version__,
        'transformers': transformers.__version__, 'device': sidecar.DEVICE,
        'torch_threads': torch.get_num_threads(), 'model': sidecar.MODEL,
        'executionAuthority': 'none'
    }, indent=2))
    print('capture sidecar ready', flush=True)
    sidecar.ThreadingHTTPServer((sidecar.HOST, sidecar.PORT), sidecar.Handler).serve_forever()
