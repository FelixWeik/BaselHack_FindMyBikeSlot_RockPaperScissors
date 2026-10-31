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


def detect_bike_dents_v7(data, edge_limit=1850.0, trend_window=201,
                          min_depth=50.0, min_run=6, max_depth=100.0,
                          ransac_thresh=250.0, min_samples=0.55):
    """
    Detect bike dents using RANSAC parabola fit + detrended residual peaks.

    Strategy:
    1. Fit RANSAC parabola to (step, VL53) point cloud
    2. Compute signed residuals (VL53 - parabola)
    3. Remove smooth trend with a wide rolling median to get detrended residuals
    4. Find candidate contiguous regions where |detrended| > min_depth
    5. Keep only regions with a peak |detrended| > max_depth (true bike dents)

    Note: Edge cutoff is applied to X only (both -edge_limit and +edge_limit in
    radar XY space). The Y direction is NOT cut.

    Returns (steps, outlier_mask, model, signed_resid, trend, detrended).
    """
    X = data[:, 0].reshape(-1, 1)
    y = data[:, 1]

    model = make_pipeline(
        PolynomialFeatures(degree=2),
        RANSACRegressor(estimator=None, min_samples=min_samples,
                        residual_threshold=ransac_thresh, max_trials=500, random_state=42),
    )
    model.fit(X, y)
    y_pred = model.predict(X)

    signed_resid = y - y_pred
    n = len(y)

    # Wide rolling median to estimate smooth trend
    half_win = trend_window // 2
    trend = np.zeros(n)
    for i in range(n):
        lo = max(0, i - half_win)
        hi = min(n, i + half_win + 1)
        trend[i] = np.median(signed_resid[lo:hi])

    detrended = signed_resid - trend

    # Candidate regions: contiguous runs where |detrended| > min_depth
    is_cand = np.abs(detrended) > min_depth
    candidate_regions = []
    i = 0
    while i < n:
        if is_cand[i]:
            j = i
            while j < n and is_cand[j]:
                j += 1
            if (j - i) >= min_run:
                candidate_regions.append((i, j))
            i = j
        else:
            i += 1

    # Keep only regions with a strong peak (true bike dent)
    outlier_mask = np.zeros(n, dtype=bool)
    for (start, end) in candidate_regions:
        peak = np.max(np.abs(detrended[start:end]))
        if peak > max_depth:
            outlier_mask[start:end] = True

    inlier_mask = ~outlier_mask

    return (X, y, model, inlier_mask, outlier_mask,
            signed_resid, trend, detrended)


def plot_radar_view(steps, vl53, angle, inlier_mask, outlier_mask,
                    filepath, save_path=None, max_distance_mm=None,
                    edge_limit=1850.0):
    """Create radar XY plot with inliers (green) and outliers (red)."""
    fig, ax = plt.subplots(figsize=(11, 8))
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("X (mm)")
    ax.set_ylabel("Y (mm)")
    ax.grid(True)
    ax.scatter([0], [0], marker="+", s=70, c="black", label="Radar")

    x_all = -vl53 * np.sin(angle)
    y_all = -vl53 * np.cos(angle)

    # Determine which points are within the edge cutoff (full data size, X only)
    in_cutoff = (np.abs(x_all) <= edge_limit)

    # Map the detection masks (from filtered data) back to full-data indices
    # Outlier/inlier masks are for the in-cutoff subset; expand to full length
    full_inlier = np.zeros(len(vl53), dtype=bool)
    full_outlier = np.zeros(len(vl53), dtype=bool)
    full_inlier[in_cutoff] = inlier_mask
    full_outlier[in_cutoff] = outlier_mask

    if max_distance_mm is not None:
        vl53_mask = vl53 <= max_distance_mm
        inlier_plot_mask = vl53_mask & full_inlier
        outlier_plot_mask = vl53_mask & full_outlier
        title_suffix = f" (dist <= {max_distance_mm} mm, edges cut at +/-{edge_limit:.0f})"
    else:
        inlier_plot_mask = full_inlier
        outlier_plot_mask = full_outlier
        title_suffix = f" (all distances, edges cut at +/-{edge_limit:.0f} mm)"

    ax.scatter(x_all[inlier_plot_mask], y_all[inlier_plot_mask],
               s=12, marker="o", c="green", alpha=0.6,
               label=f"VL53 inliers ({inlier_plot_mask.sum()})")
    ax.scatter(x_all[outlier_plot_mask], y_all[outlier_plot_mask],
               s=40, marker="x", c="red", lw=2, zorder=5,
               label=f"VL53 outliers ({outlier_plot_mask.sum()})")

    # Draw edge cutoff boundary (square in XY space)
    ax.plot([-edge_limit, edge_limit, edge_limit, -edge_limit, -edge_limit],
            [-edge_limit, -edge_limit, edge_limit, edge_limit, -edge_limit],
            'k--', lw=1, alpha=0.5, label=f"Edge cut +/-{edge_limit:.0f} mm")

    # Compute plot bounds based on in-cutoff region
    region_in_cut = in_cutoff & (full_inlier | full_outlier)
    if region_in_cut.any():
        all_xy_cut = np.concatenate([
            x_all[region_in_cut],
            y_all[region_in_cut],
        ])
        maximum = max(edge_limit * 1.1, float(np.max(np.abs(all_xy_cut))) * 1.1)
    else:
        maximum = edge_limit * 1.1

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


def process_file(filepath, ransac_thresh=250.0, min_samples=0.55, edge_limit=1850.0,
                 trend_window=201, min_depth=50.0, min_run=6, max_depth=100.0,
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

    # Apply edge cutoff in radar XY space (X direction only: -edge_limit to +edge_limit)
    keep = (np.abs(x) <= edge_limit)
    steps_c = steps[keep]
    vl53_c = vl53[keep]
    n_in_cutoff = keep.sum()

    print(f"  Edge cutoff +/-{edge_limit:.0f}mm: kept {n_in_cutoff}/{n_total} points ({100.0*n_in_cutoff/n_total:.1f}%)")

    if n_in_cutoff < 50:
        print("  Too few points after edge cutoff, skipping analysis.")
        return {}

    data = np.column_stack([steps_c, vl53_c])
    (X, y_fit, model, inlier_mask, outlier_mask, signed_resid,
     trend, detrended) = detect_bike_dents_v7(
        data, edge_limit=edge_limit, trend_window=trend_window,
        min_depth=min_depth, min_run=min_run, max_depth=max_depth,
        ransac_thresh=ransac_thresh, min_samples=min_samples)

    n_out = outlier_mask.sum()
    n_in = n_in_cutoff - n_out
    pct = 100.0 * n_out / n_in_cutoff

    print(f"  Dent detection: min_depth={min_depth:.0f}mm, min_run={min_run}, max_depth={max_depth:.0f}mm")
    print(f"  Outliers (bike dents): {n_out}/{n_in_cutoff} ({pct:.1f}%)")

    if n_out > 0:
        out_steps = steps_c[outlier_mask]
        groups = []
        if len(out_steps) > 0:
            current_start = int(out_steps[0])
            current_end = int(out_steps[0])
            for s in out_steps[1:]:
                s = int(s)
                if s - current_end > 10:
                    groups.append((current_start, current_end))
                    current_start = s
                current_end = s
            groups.append((current_start, current_end))

        print(f"  Detected segments (bike candidates):")
        for start, end in groups:
            n_in_seg = ((steps_c >= start) & (steps_c <= end) & outlier_mask).sum()
            # Get coordinates for this segment
            seg_mask = (steps_c >= start) & (steps_c <= end) & outlier_mask
            if seg_mask.any():
                x_seg = -vl53_c[seg_mask] * np.sin(angle[keep][seg_mask])
                y_seg = -vl53_c[seg_mask] * np.cos(angle[keep][seg_mask])
                print(f"    Steps {start:5d}-{end:5d}: {n_in_seg:4d} pts | "
                      f"X=[{x_seg.min():.0f},{x_seg.max():.0f}] Y=[{y_seg.min():.0f},{y_seg.max():.0f}]")

    if save_plot:
        out_name = Path(filepath).stem + "_radar_ransac.png"
        save_path = Path("output") / out_name
    else:
        save_path = None

    # Plot all points but mark the ones within cutoff as inlier/outlier
    plot_radar_view(steps, vl53, angle, inlier_mask, outlier_mask,
                    filepath, save_path, max_distance_mm=None, edge_limit=edge_limit)

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
            "outlier_pct": pct, "threshold": ransac_thresh}


def process_all(ransac_thresh=250.0, min_samples=0.55, edge_limit=1850.0,
                trend_window=201, min_depth=50.0, min_run=6, max_depth=100.0,
                max_distance_mm=None):
    """Process all log files from code/Hardware/logs/ (or fallback locations)."""
    # Script is at: code/backend/lidar/lidar_ransac_radar_view.py
    # Repo root: 3 levels up from script dir's parent chain
    script_dir = Path(__file__).resolve().parent  # code/backend/lidar
    repo_root = script_dir.parent.parent.parent  # repo root

    # Primary: code/Hardware/logs/
    log_directory = repo_root / "code" / "Hardware" / "logs"
    files = sorted(log_directory.glob("*.txt"))

    # Fallback 1: relative path code/Hardware/logs
    if not files:
        rel = Path("code/Hardware/logs")
        if rel.exists():
            files = sorted(rel.glob("*.txt"))

    # Fallback 2: assets/lidarData/
    if not files:
        assets_dir = repo_root / "assets" / "lidarData"
        files = sorted(assets_dir.glob("*.txt"))

    # Fallback 3: relative assets/lidarData
    if not files:
        rel_assets = Path("assets/lidarData")
        if rel_assets.exists():
            files = sorted(rel_assets.glob("*.txt"))

    if not files:
        print("No .txt files found!")
        return

    print(f"Found {len(files)} files:")
    results = []
    for f in files:
        r = process_file(str(f), ransac_thresh=ransac_thresh, min_samples=min_samples,
                         edge_limit=edge_limit, trend_window=trend_window,
                         min_depth=min_depth, min_run=min_run, max_depth=max_depth,
                         max_distance_mm=max_distance_mm)
        if r:
            results.append(r)

    print("\n" + "="*70 + "\nSUMMARY\n" + "="*70)
    print(f"{'File':<45} {'Pts':>6} {'Out':>6} {'%':>6}")
    print("-" * 65)
    for r in results:
        print(f"{Path(r['file']).name:<45} {r['n_points']:>6} {r['n_outliers']:>6} "
              f"{r['outlier_pct']:>5.1f}%")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Bike dent detection via RANSAC parabola + detrended residual peaks")
    parser.add_argument("file", nargs="?", default=None,
                        help="Specific file or all files if omitted")
    parser.add_argument("--ransac-thresh", type=float, default=250.0)
    parser.add_argument("--min-samples", type=float, default=0.55)
    parser.add_argument("--edge-limit", type=float, default=1850.0,
                        help="Cut off edges beyond +/- this limit in radar XY space (mm)")
    parser.add_argument("--trend-window", type=int, default=201,
                        help="Width of rolling median window for smooth trend (steps)")
    parser.add_argument("--min-depth", type=float, default=50.0,
                        help="Lower threshold for candidate detrended residual (mm)")
    parser.add_argument("--min-run", type=int, default=6,
                        help="Minimum contiguous points in a candidate region")
    parser.add_argument("--max-depth", type=float, default=100.0,
                        help="Peak threshold - candidate region must exceed this (mm)")
    parser.add_argument("--max-distance", type=float, default=None,
                        help="Optional max distance filter in mm. Default: all points shown")
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.file:
        process_file(args.file, ransac_thresh=args.ransac_thresh,
                     min_samples=args.min_samples, edge_limit=args.edge_limit,
                     trend_window=args.trend_window, min_depth=args.min_depth,
                     min_run=args.min_run, max_depth=args.max_depth,
                     save_plot=not args.no_save, quiet=args.quiet,
                     max_distance_mm=args.max_distance)
    else:
        process_all(ransac_thresh=args.ransac_thresh, min_samples=args.min_samples,
                    edge_limit=args.edge_limit, trend_window=args.trend_window,
                    min_depth=args.min_depth, min_run=args.min_run,
                    max_depth=args.max_depth, max_distance_mm=args.max_distance)
