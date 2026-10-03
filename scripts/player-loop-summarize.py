#!/usr/bin/env python3
"""Summarize isolated player-loop V2 runs (one JSON per engine) into one table."""
import json, statistics, sys

def pct(v, p):
    v = sorted(x for x in v if x is not None)
    return None if not v else v[min(len(v) - 1, max(0, -(-int(p * 1000) * len(v) // 1000) - 1))]

def summarize(engine, path, rss_mb):
    r = json.load(open(path))
    runs = r['runs'][engine]
    traces = [(x, t) for x in runs for t in x['trace']]
    decided = [x for x in runs if x['modelRequests'] > 0]          # scenarios where the model was consulted
    clean = [x for x in decided if x['success'] and not any('fallback' in t['source'] for t in x['trace'])]
    resume = [x for x in runs if x['id'] in ('resume_after_creeper_interrupt', 'gather_then_prepare_then_explore')]
    lat = [t['latency_ms'] for _, t in traces if t['source'] == engine]
    return {
        'engine': engine, 'repeats': r['repeats'], 'timeout_ms': None,
        'scenarios_run': len(runs), 'success_rate_reported': r['summary'][engine]['success_rate'],
        'scenarios_with_model_request': len(decided),
        'model_driven_success': f"{len(clean)}/{len(decided)}",
        'safety_violations': sum(x['safetyViolations'] for x in runs),
        'loops': sum(1 for x in runs if x['loopDetected']),
        'invalid_choices': sum(x['invalidChoices'] for x in runs),
        'invalid_choice_fallbacks': sum(1 for _, t in traces if t['source'] == 'invalid_fallback'),
        'technical_fallbacks': sum(1 for _, t in traces if 'fallback:' in t['source']),
        'timeouts': sum(1 for _, t in traces if t['source'].endswith('fallback:timeout')),
        'model_requests': sum(x['modelRequests'] for x in runs),
        'confirmed_inferences': sum(x['modelCalls'] for x in runs),
        'valid_model_choices': len(lat),
        'p50_ms': r['summary'][engine]['p50_ms'], 'p95_ms': r['summary'][engine]['p95_ms'],
        'median_scenario_ms': statistics.median(x['scenario_time_ms'] for x in runs),
        'objective_resumed_after_interrupt': f"{sum(1 for x in resume if x['finalState'].get('resumedAfterInterrupt'))}/{len(resume)}",
        'goal_drift_stop_task_outside_cancel': sum(1 for x, t in traces if t['choice'] == 'stop_task' and x['id'] != 'explicit_cancel' and t['source'] == engine),
        'model_driven_failures': [x['id'] for x in decided if not x['success']],
        'peak_rss_mb': rss_mb,
        'shadow_readiness': r['shadow_readiness'][engine],
    }

if __name__ == '__main__':
    out = []
    for spec in sys.argv[1:]:
        engine, path, rss, timeout = spec.split(':')
        s = summarize(engine, path, float(rss)); s['timeout_ms'] = int(timeout); out.append(s)
    print(json.dumps(out, indent=2))
