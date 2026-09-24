#!/usr/bin/env python3
"""Train and evaluate SkyForge's compact browser anomaly classifier.

Uses only the Python standard library. Synthetic flights are split by flight,
not by individual window, so adjacent windows cannot leak into evaluation.
GPS coordinates are intentionally absent from every feature row.
"""
from __future__ import annotations
import argparse, json, math, random
from pathlib import Path

FEATURES = ["battery_voltage_v", "gps_satellites", "vibration_peak_mps2", "attitude_error_rad", "high_throttle_descent", "ekf_max_variance", "motor_rpm_deviation", "attitude_age_ms"]
MEANS = [12.3, 14, 5, .04, 0, .2, .01, 0]
SCALES = [1, 5, 20, .4, 2, 1, .2, 2000]

def flights(seed=9341):
    rng = random.Random(seed)
    result = []
    for flight_id in range(240):
        faulty = flight_id % 3 != 0
        kind = (flight_id // 3) % len(FEATURES)
        rows = []
        for _ in range(20):
            x = [rng.gauss(m, s * .08) for m, s in zip(MEANS, SCALES)]
            if faulty:
                # Half are subtle multi-signal anomalies that fixed single limits miss.
                if flight_id % 4 == 1:
                    for idx in (kind, (kind + 2) % len(x), (kind + 5) % len(x)):
                        direction = -1 if idx in (0, 1) else 1
                        x[idx] += direction * SCALES[idx] * rng.uniform(.45, .75)
                else:
                    direction = -1 if kind in (0, 1) else 1
                    x[kind] += direction * SCALES[kind] * rng.uniform(2.2, 3.2)
            rows.append((x, int(faulty)))
        result.append(rows)
    return result

def sigmoid(z): return 1 / (1 + math.exp(-max(-30, min(30, z))))
def standardized(x): return [(v-m)/s for v,m,s in zip(x, MEANS, SCALES)]

def train(rows):
    weights, bias = [0.0] * len(FEATURES), 0.0
    for _ in range(700):
        gw, gb = [0.0] * len(weights), 0.0
        for x, y in rows:
            z = standardized(x); error = sigmoid(bias + sum(a*b for a,b in zip(weights,z))) - y
            for i, value in enumerate(z): gw[i] += error * value
            gb += error
        rate = .08 / len(rows)
        weights = [w - rate * (g + .01*w) for w,g in zip(weights,gw)]
        bias -= rate * gb
    return weights, bias

def metrics(rows, weights, bias, threshold=.75):
    tp=tn=fp=fn=0
    for x,y in rows:
        pred = sigmoid(bias + sum(a*b for a,b in zip(weights,standardized(x)))) >= threshold
        tp += pred and y; tn += (not pred) and (not y); fp += pred and not y; fn += (not pred) and y
    return {"accuracy": (tp+tn)/len(rows), "false_warning_rate": fp/max(1,fp+tn), "missed_fault_rate": fn/max(1,fn+tp), "samples": len(rows)}

def rule_metrics(rows):
    # Existing individual warning thresholds, evaluated without temporal latches.
    tp=tn=fp=fn=0
    for x,y in rows:
        pred = x[0] < 10.5 or x[1] < 6 or x[2] >= 30 or x[3] >= .349 or x[4] >= 1.5 or x[5] >= 1 or x[6] >= .25 or x[7] > 2000
        tp += pred and y; tn += (not pred) and (not y); fp += pred and not y; fn += (not pred) and y
    return {"accuracy": (tp+tn)/len(rows), "false_warning_rate": fp/max(1,fp+tn), "missed_fault_rate": fn/max(1,fn+tp), "samples": len(rows)}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args=parser.parse_args()
    data=flights(); random.Random(9341).shuffle(data); split=int(len(data)*.75)
    train_rows=[r for f in data[:split] for r in f]; test_rows=[r for f in data[split:] for r in f]
    weights,bias=train(train_rows); artifact={"version":"skyforge-anomaly-1.0.0","features":FEATURES,"means":MEANS,"scales":SCALES,"weights":[round(v,6) for v in weights],"bias":round(bias,6),"threshold":.75}
    args.output.write_text(json.dumps(artifact,indent=2)+'\n')
    print(json.dumps({"model":artifact["version"],"holdout":metrics(test_rows,weights,bias),"rules_only_holdout":rule_metrics(test_rows)},indent=2))

if __name__ == '__main__': main()
