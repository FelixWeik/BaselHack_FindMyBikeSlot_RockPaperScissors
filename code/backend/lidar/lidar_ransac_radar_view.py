#!/usr/bin/env python3

"""
RANSAC Outlier Detection with Radar XY Plot

Combines two-stage RANSAC outlier detection with radar XY visualization.
All points are plotted (no MAX_DISTANCE filter) so outliers are visible.
"""

import os
import re
from pathlib import Path
import argparse
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.linear_model import RANSACRegressor
from sklearn.preprocessing import PolynomialFeatures
from sklearn.pipeline import make_pipeline


STEPS_PER_REVOLUTION = 6400
SCAN_ANGLE_DEGREES = 170
SCAN_STEPS = STEPS_PER_REVOLUTION * SCAN_ANGLE_DEGREES / 360
LINE_PATTERN = re.compile(
    r"Step\s+(\d+)\s*:\s*VL53L1X\s*=\s*([\d.]+)\s*mm\s*,\s*"
    r"Ultrasonic\s*=\s*([\d.]+)\s*cm",
    re.IGNORECASE,
)


def read_dataset(path, max_distance_mm=None):
    """Parse LIDAR + Ultrasonic data from file."""
    points = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = LINE_PATTERN.search(line)
        if match:
            points.append((int(match.group(1)), float(match.group(2)),
                           float(match.group(3)) * 10))
    if not points:
        return (np.array([]),) * 5

    steps = np.array([p[0] for p in points], dtype=float)
    vl53 = np.array([p[1] for p in points], dtype=float)
    ultrasonic = np.array([p[2] for p in points], dtype=float)
    angle = ((steps - SCAN_STEPS / 2) * 2 * np.pi / STEPS_PER_REVOLUTION)

    if max_distance_mm is not None:
        vl53_mask = vl53 <= max_distance_mm
        x = -vl53[vl53_mask] * np.sin(angle[vl53_mask])
        y = -vl53[vl53_mask] * np.cos(angle[vl53_mask])
    else:
        x = -vl53 * np.sin(angle)
        y = -vl53 * np.cos(angle)

    return steps, vl53, angle, x, y


def detect_outliers_ransac2(data, ransac_thresh=250.0, min_samples=0.55, mad_mult=6.0):
    """Two-stage RANSAC outlier detection."""
    X = data[:, 0].reshape(-1, 1)
    y = data[:, 1]

    model = make_pipeline(
        PolynomialFeatures(degree=2),
        RANSACRegressor(
            estimator=None, min_samples=min_samples,
            residual_threshold=ransac_thresh, max_trials=500, random_state=42,
        ),
    )
    model.fit(X, y)

    ransac = model.named_steps["ransacregressor"]
    ransac_inlier_mask = ransac.inlier_mask_

    y_pred = model.predict(X)
    residuals = np.abs(y - y_pred)

    inlier_resid = residuals[ransac_inlier_mask]
    mad = np.median(np.abs(inlier_resid - np.median(inlier_resid)))
    med_resid = np.median(inlier_resid)
    threshold = med_resid + mad_mult * mad

    outlier_mask = residuals > threshold
    inlier_mask = ~outlier_mask

    return (X, y, model, inlier_mask, outlier_mask,
            residuals, threshold, med_resid, mad)


def plot_radar_view(steps, vl53, angle, inlier_mask, outlier_mask,
                    filepath, save_path=None, max_distance_mm=None):
    """Create radar XY plot with inliers (green) and outliers (red)."""
    fig, ax = plt.subplots(figsize=(11, 8))
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("X (mm)")
    ax.set_ylabel("Y (mm)")
    ax.grid(True)
    ax.scatter([0], [0], marker="+", s=70, c="black", label="Radar")

    if max_distance_mm is not None:
        vl53_mask = vl53 <= max_distance_mm
        inlier_plot_mask = vl53_mask & inlier_mask
        outlier_plot_mask = vl53_mask & outlier_mask
        title_suffix = f" (dist <= {max_distance_mm} mm)"
    else:
        inlier_plot_mask = inlier_mask
        outlier_plot_mask = outlier_mask
        title_suffix = " (all distances)"

    x_all = -vl53 * np.sin(angle)
    y_all = -vl53 * np.cos(angle)

    ax.scatter(x_all[inlier_plot_mask], y_all[inlier_plot_mask],
               s=12, marker="o", c="green", alpha=0.6,
               label=f"VL53 inliers ({inlier_plot_mask.sum()})")
    ax.scatter(x_all[outlier_plot_mask], y_all[outlier_plot_mask],
               s=40, marker="x", c="red", lw=2, zorder=5,
               label=f"VL53 outliers ({outlier_plot_mask.sum()})")

    if inlier_plot_mask.any() or outlier_plot_mask.any():
        all_xy = np.concatenate([
            x_all[inlier_plot_mask | outlier_plot_mask],
            y_all[inlier_plot_mask | outlier_plot_mask],
        ])
        maximum = max(100, float(np.max(np.abs(all_xy))) * 1.1)
    else:
        maximum = 100

    ax.set_xlim(-maximum, maximum)
    ax.set_ylim(-maximum, maximum)
    ax.set_title(f"ESP32 Radar XY with Outliers - {Path(filepath).stem}{title_suffix}")
    ax.legend(loc="upper left", bbox_to_anchor=(1.01, 1), fontsize=8)

    plt.tight_layout()

    if save_path:
        os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
        plt.savefig(save_path, dpi=150, bbox_inches="tight")
        print(f"  Plot saved: {save_path}")
    else:
        plt.show()
    plt.close(fig)


def process_file(filepath, ransac_thresh=250.0, min_samples=0.55, mad_mult=6.0,
                 save_plot=True, quiet=False, max_distance_mm=None):
    print(f"\n{'='*70}\nProcessing: {filepath}\n{'='*70}")
    path = Path(filepath)
    steps, vl53, angle, x, y = read_dataset(path, max_distance_mm=None)

    if len(steps) == 0:
        print("  No parseable data found!")
        return {}

    n_total = len(steps)
    print(f"  Points: {n_total}, Steps {int(steps.min())}-{int(steps.max())}, "
          f"VL53L1X range: {vl53.min():.0f}-{vl53.max():.0f} mm")

    data = np.column_stack([steps, vl53])
    (X, y_fit, model, inlier_mask, outlier_mask, residuals, threshold,
     med_res, mad) = detect_outliers_ransac2(
        data, ransac_thresh=ransac_thresh,
        min_samples=min_samples, mad_mult=mad_mult)

    n_out = outlier_mask.sum()
    pct = 100.0 * n_out / n_total

    print(f"  Stage 1 RANSAC: threshold={ransac_thresh}mm, min_samples={min_samples}")
    print(f"  Stage 2: median residual={med_res:.0f}mm, MAD={mad:.0f}mm, threshold={threshold:.0f}mm")
    print(f"  Outliers: {n_out}/{n_total} ({pct:.1f}%)")

    if n_out > 0:
        out_steps = np.sort(X[outlier_mask, 0].astype(int))
        groups = []
        if len(out_steps) > 0:
            current_start = out_steps[0]
            current_end = out_steps[0]
            for s in out_steps[1:]:
                if s - current_end > 10:
                    groups.append((current_start, current_end))
                    current_start = s
                current_end = s
            groups.append((current_start, current_end))

        print(f"  Outlier segments:")
        for start, end in groups:
            n_in_seg = ((X[:,0] >= start) & (X[:,0] <= end) & outlier_mask).sum()
            print(f"    Steps {start:5d}-{end:5d}: {n_in_seg:4d} outliers")

    if save_plot:
        out_name = Path(filepath).stem + "_radar_ransac.png"
        save_path = Path("output") / out_name
    else:
        save_path = None

    plot_radar_view(steps, vl53, angle, inlier_mask, outlier_mask,
                    filepath, save_path, max_distance_mm=None)

    ransac_est = model.named_steps["ransacregressor"]
    try:
        coef = ransac_est.estimator_.coef_
        intercept = ransac_est.estimator_.intercept_
        print(f"\n  Fitted parabola (step vs. distance):")
        print(f"    distance = {coef[2]:.8f}*step^2 + {coef[1]:.5f}*step + {intercept:.2f}")
        vertex_x = -coef[1] / (2 * coef[2])
        vertex_y = coef[2] * vertex_x**2 + coef[1] * vertex_x + intercept
        print(f"    Vertex: step={vertex_x:.0f}, distance={vertex_y:.0f} mm")
    except (AttributeError, IndexError):
        pass

    return {"file": filepath, "n_points": n_total, "n_outliers": n_out,
            "outlier_pct": pct, "threshold": threshold}


def process_all(ransac_thresh=250.0, min_samples=0.55, mad_mult=6.0, max_distance_mm=None):
    log_directory = Path(__file__).resolve().parent.parent.parent.parent / "assets" / "lidarData"
    files = sorted(log_directory.glob("*.txt"))
    if not files:
        files = sorted(Path("assets/lidarData").glob("*.txt"))
    if not files:
        print("No .txt files found!")
        return

    print(f"Found {len(files)} files:")
    results = []
    for f in files:
        r = process_file(str(f), ransac_thresh, min_samples, mad_mult,
                         max_distance_mm=max_distance_mm)
        if r:
            results.append(r)

    print("\n" + "="*70 + "\nSUMMARY\n" + "="*70)
    print(f"{'File':<35} {'Pts':>6} {'Out':>6} {'%':>6} {'Thresh':>7}")
    print("-" * 65)
    for r in results:
        print(f"{Path(r['file']).name:<35} {r['n_points']:>6} {r['n_outliers']:>6} "
              f"{r['outlier_pct']:>5.1f}% {r['threshold']:>6.0f}mm")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RANSAC outlier detection in radar XY view")
    parser.add_argument("file", nargs="?", default=None,
                        help="Specific file or all files if omitted")
    parser.add_argument("--ransac-thresh", type=float, default=250.0)
    parser.add_argument("--min-samples", type=float, default=0.55)
    parser.add_argument("--mad-mult", type=float, default=6.0)
    parser.add_argument("--max-distance", type=float, default=None,
                        help="Optional max distance filter in mm. Default: all points shown")
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.file:
        process_file(args.file, args.ransac_thresh, args.min_samples, args.mad_mult,
                     not args.no_save, args.quiet, max_distance_mm=args.max_distance)
    else:
        process_all(args.ransac_thresh, args.min_samples, args.mad_mult,
                    max_distance_mm=args.max_distance)
