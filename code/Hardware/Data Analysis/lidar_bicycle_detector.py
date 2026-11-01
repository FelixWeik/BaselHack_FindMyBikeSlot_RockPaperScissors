#!/usr/bin/env python3
"""
LiDAR line-scan bicycle-region detector.

Expected layout:
    pos1/*ref*.txt      = empty/background reference scan(s)
    pos1/*.txt          = measurements from the first position
    pos2/*.txt          = measurements from the second data set

The scan position is matched by filename: files containing "newpos" use
ref_newpos.txt; all other measurement files use reference.txt.

Each input file contains lines such as:
  Step 1: VL53L1X = 2246 mm, Ultrasonic = 0 cm

The detector compares smoothed measurement and reference points in XY space.
It marks regions where the point-to-point XY displacement exceeds a threshold.
This is a first-pass, reference-based detector, not a trained ML model.
Tune THRESHOLD_MM, MIN_REGION_STEPS, and MERGE_GAP_STEPS using labelled real scans.
Multiple separated regions are reported independently for each measurement scan.
"""

import argparse
import csv
import re
from pathlib import Path

import numpy as np

try:
    from scipy.ndimage import median_filter
except ImportError as exc:
    raise SystemExit(
        "Missing dependency. Install with: pip install numpy scipy matplotlib"
    ) from exc

# --- Initial parameters to tune against labelled scans ---
SMOOTH_WINDOW = 21       # median-filter width in scan steps; should be odd
THRESHOLD_MM = 70        # XY displacement from reference, in millimetres
MIN_REGION_STEPS = 8     # ignore very short isolated detections
MERGE_GAP_STEPS = 10     # merge nearby detections separated by small gaps
MAX_ZERO_CROSSING_GAP_STEPS = 3  # crossing must be brief; longer near-reference gaps are not bikes
PLOT_RESULTS = True

VALUE_RE = re.compile(
    r"Step\s+(\d+):\s*VL53L1X\s*=\s*(-?\d+)\s*mm", re.IGNORECASE
)
LINE_PATTERN = re.compile(
    r"Step\s+(\d+):\s*VL53L1X\s*=\s*(-?\d+(?:\.\d+)?)\s*mm, "
    r"\s*Ultrasonic\s*=\s*(-?\d+(?:\.\d+)?)\s*cm",
    re.IGNORECASE,
)

# XY plotting parameters.  Ultrasonic values are recorded in centimetres.
# One complete revolution is 6400 motor steps (step 0 is 0 degrees).
STEPS_PER_REVOLUTION = 6400
MAX_DISTANCE_MM = 4000
MAX_X_MM = 2000


def polar_to_xy(steps, distances_mm):
    """Convert scan steps and radial distances to Cartesian millimetres.

    The motor performs one complete revolution in 6400 steps, so one step is
    360 / 6400 degrees.  Step 0 and step 6400 are the same direction.
    Angles increase counter-clockwise from the positive X axis.
    """
    steps = np.asarray(steps, dtype=float)
    distances_mm = np.asarray(distances_mm, dtype=float)
    angle_rad = (np.mod(steps, STEPS_PER_REVOLUTION)
                 * (2.0 * np.pi / STEPS_PER_REVOLUTION))
    return (-distances_mm * np.cos(angle_rad),
            -distances_mm * np.sin(angle_rad))


def read_scan(path):
    """Return the complete, untrimmed LiDAR scan for classification."""
    text = path.read_text(encoding="utf-8", errors="replace")
    values = {}
    for step, distance in VALUE_RE.findall(text):
        values[int(step)] = float(distance)
    if not values:
        raise ValueError(f"No VL53L1X step measurements found in {path.name}")
    return values


def read_dataset(path):
    """Return the filtered XY points and their step numbers for display."""
    points = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = LINE_PATTERN.search(line)
        if match:
            points.append((
                int(match.group(1)),
                float(match.group(2)),
                float(match.group(3)) * 10,
            ))

    if not points:
        return (np.array([]),) * 5

    steps = np.array([point[0] for point in points])
    vl53 = np.array([point[1] for point in points])
    ultrasonic = np.array([point[2] for point in points])

    vl53_x, vl53_y = polar_to_xy(steps, vl53)
    ultrasonic_x, ultrasonic_y = polar_to_xy(steps, ultrasonic)

    vl53_mask = (
        (vl53 <= MAX_DISTANCE_MM)
        & (np.abs(vl53_x) <= MAX_X_MM)
    )
    ultrasonic_mask = (
        (ultrasonic <= MAX_DISTANCE_MM)
        & (np.abs(ultrasonic_x) <= MAX_X_MM)
    )

    return (
        steps[vl53_mask],
        vl53_x[vl53_mask],
        vl53_y[vl53_mask],
        ultrasonic_x[ultrasonic_mask],
        ultrasonic_y[ultrasonic_mask],
    )


def to_aligned_array(values, max_step=None):
    """Convert a step dictionary to an array indexed by step number."""
    if max_step is None:
        max_step = max(values)
    result = np.full(max_step + 1, np.nan, dtype=float)
    for step, value in values.items():
        if 1 <= step <= max_step:
            result[step] = value
    return result


def smooth_valid_segments(values, window):
    """Median-filter contiguous valid runs without filling missing steps."""
    out = np.full_like(values, np.nan, dtype=float)
    valid = np.isfinite(values)
    idx = np.flatnonzero(valid)
    if not len(idx):
        return out

    # Split at missing step numbers so partial scans are not joined across gaps.
    split_points = np.flatnonzero(np.diff(idx) > 1) + 1
    for segment in np.split(idx, split_points):
        if not len(segment):
            continue
        x = values[segment]
        # scipy median_filter works best with an odd window; cap for short runs.
        w = min(window, len(x) if len(x) % 2 else max(1, len(x) - 1))
        w = max(1, w)
        if w % 2 == 0:
            w -= 1
        out[segment] = median_filter(x, size=w, mode="nearest")
    return out


def fill_small_gaps(mask, max_gap, signed_difference=None, valid=None,
                    max_zero_crossing_gap=None):
    """Fill false gaps up to max_gap samples between true detections."""
    mask = mask.copy()
    true_idx = np.flatnonzero(mask)
    for left, right in zip(true_idx[:-1], true_idx[1:]):
        if 0 < right - left - 1 <= max_gap:
            # Do not let the general merge rule undo the zero-crossing rule:
            # a long interval close to the reference is background, even if
            # detections happen to occur on opposite sides of it.
            if (signed_difference is not None and valid is not None
                    and max_zero_crossing_gap is not None):
                interval = np.arange(left, right + 1)
                values = signed_difference[interval]
                finite = np.isfinite(values) & valid[interval]
                values = values[finite]
                crosses_zero = (len(values) > 0 and np.any(values < 0)
                                and np.any(values > 0))
                if crosses_zero and right - left - 1 > max_zero_crossing_gap:
                    continue
            mask[left:right + 1] = True
    return mask


def bridge_zero_crossing_gaps(mask, signed_difference, valid, max_gap):
    """Join detections when the measurement crosses the reference in between.

    A bicycle can produce a dip to the reference followed by a rise on the
    opposite side.  The absolute difference then briefly falls below the
    threshold, even though both sides belong to one physical object.
    """
    mask = mask.copy()
    true_idx = np.flatnonzero(mask)
    for left, right in zip(true_idx[:-1], true_idx[1:]):
        # A crossing is only bicycle-like when it happens quickly.  If the
        # signal remains near the reference for longer, leave the gap open.
        if right - left <= 1 or right - left - 1 > max_gap:
            continue
        interval = np.arange(left, right + 1)
        if not np.all(valid[interval]):
            continue
        values = signed_difference[interval]
        values = values[np.isfinite(values)]
        if len(values) and np.any(values < 0) and np.any(values > 0):
            mask[left:right + 1] = True
    return mask


def regions_from_mask(mask, min_steps):
    """Return inclusive (start_step, end_step) regions from a Boolean mask."""
    idx = np.flatnonzero(mask)
    if not len(idx):
        return []
    split_points = np.flatnonzero(np.diff(idx) > 1) + 1
    regions = []
    for segment in np.split(idx, split_points):
        if len(segment) >= min_steps:
            # Array index is the step number because index 0 is unused.
            regions.append((int(segment[0]), int(segment[-1])))
    return regions


def blocks_for_region(region, measured_distances, block_size_mm):
    """Return axis-aligned square blocks that fit the detected XY area.

    The region's LiDAR points define a bounding rectangle.  The rectangle is
    clipped to the display's -MAX_X_MM..MAX_X_MM working area before placing
    non-overlapping blocks from its lower-left corner.
    """
    start, end = region
    steps = np.arange(start, end + 1)
    distances = measured_distances[start:end + 1]
    finite = np.isfinite(distances)
    if not np.any(finite):
        return []

    x, y = polar_to_xy(steps[finite], distances[finite])
    x_min = max(-MAX_X_MM, float(np.min(x)))
    x_max = min(MAX_X_MM, float(np.max(x)))
    y_min = float(np.min(y))
    y_max = float(np.max(y))
    columns = max(0, int(np.floor((x_max - x_min) / block_size_mm)))
    rows = max(0, int(np.floor((y_max - y_min) / block_size_mm)))

    positions = []
    for row in range(rows):
        for column in range(columns):
            positions.append((
                round(x_min + (column + 0.5) * block_size_mm, 1),
                round(y_min + (row + 0.5) * block_size_mm, 1),
            ))
    return positions


def fit_periodic_reference(values, harmonics=32, iterations=5):
    """Create a smooth periodic background reference without changing the original."""
    values = np.asarray(values, dtype=float)
    steps = np.arange(values.size, dtype=float)
    valid = np.isfinite(values)

    if np.count_nonzero(valid) < 10:
        return values.copy()

    angle = 2.0 * np.pi * steps / STEPS_PER_REVOLUTION
    design = [np.ones(values.size)]

    for harmonic in range(1, harmonics + 1):
        design.append(np.cos(harmonic * angle))
        design.append(np.sin(harmonic * angle))

    design = np.column_stack(design)
    fit_valid = valid

    for _ in range(iterations):
        coefficients, *_ = np.linalg.lstsq(
            design[fit_valid],
            values[fit_valid],
            rcond=None,
        )
        fitted = design @ coefficients
        residual = values - fitted
        good_residual = residual[valid]
        median = np.median(good_residual)
        mad = np.median(np.abs(good_residual - median))
        scale = max(1.4826 * mad, 1.0)
        fit_valid = valid & (np.abs(residual - median) <= 3.0 * scale)

    fitted = design @ coefficients
    fitted[~valid] = np.nan
    return fitted


def fit_periodic_coefficients(values, harmonics=32, iterations=5):
    """Return Fourier coefficients that can be evaluated directly on an ESP32.

    Coefficients are ordered as constant, cos(1), sin(1), cos(2), sin(2), ...
    and use the same equation as ``fit_periodic_reference``.
    """
    values = np.asarray(values, dtype=float)
    steps = np.arange(values.size, dtype=float)
    valid = np.isfinite(values)
    angle = 2.0 * np.pi * steps / STEPS_PER_REVOLUTION
    design = [np.ones(values.size)]
    for harmonic in range(1, harmonics + 1):
        design.append(np.cos(harmonic * angle))
        design.append(np.sin(harmonic * angle))
    design = np.column_stack(design)

    if np.count_nonzero(valid) < max(10, design.shape[1]):
        raise ValueError("Not enough valid reference samples to export a fit")

    fit_valid = valid.copy()
    coefficients = None
    for _ in range(iterations):
        coefficients, *_ = np.linalg.lstsq(
            design[fit_valid], values[fit_valid], rcond=None
        )
        residual = values - design @ coefficients
        good = residual[valid]
        median = np.median(good)
        mad = np.median(np.abs(good - median))
        scale = max(1.4826 * mad, 1.0)
        fit_valid = valid & (np.abs(residual - median) <= 3.0 * scale)
    return coefficients


def write_esp32_reference_header(path, old_coefficients, new_coefficients,
                                 harmonics):
    """Write the fitted reference and its ESP32 evaluation function as C++."""
    def c_array(name, coefficients):
        values = ", ".join(f"{value:.9g}f" for value in coefficients)
        return f"static const float {name}[{len(coefficients)}] = {{{values}}};"

    header = f"""// Generated by lidar_bicycle_detector.py
// Background distance: c[0] + sum(c[2n-1]*cos(n*a) + c[2n]*sin(n*a))
#pragma once
#include <math.h>

#define LIDAR_STEPS_PER_REVOLUTION {STEPS_PER_REVOLUTION}
#define LIDAR_REFERENCE_HARMONICS {harmonics}
{c_array('lidarReferenceOld', old_coefficients)}
{c_array('lidarReferenceNew', new_coefficients)}

static inline float lidarReferenceDistance(float step, bool newPosition) {{
    const float* c = newPosition ? lidarReferenceNew : lidarReferenceOld;
    const float angle = 2.0f * PI * step / LIDAR_STEPS_PER_REVOLUTION;
    float result = c[0];
    for (int n = 1; n <= LIDAR_REFERENCE_HARMONICS; ++n) {{
        result += c[2 * n - 1] * cosf(n * angle);
        result += c[2 * n] * sinf(n * angle);
    }}
    return result;
}}
"""
    path.write_text(header, encoding="utf-8")


def classify_against_reference(
    measured_s,
    reference_s,
    max_step,
    threshold_mm,
    merge_gap_steps,
    min_region_steps,
):
    """Run classification against a supplied reference."""
    steps = np.arange(max_step + 1)
    valid = np.isfinite(measured_s) & np.isfinite(reference_s)

    measured_x, measured_y = polar_to_xy(steps, measured_s)
    reference_x, reference_y = polar_to_xy(steps, reference_s)

    diff = np.full(max_step + 1, np.nan)
    diff[valid] = np.hypot(
        measured_x[valid] - reference_x[valid],
        measured_y[valid] - reference_y[valid],
    )

    mask = np.zeros(max_step + 1, dtype=bool)
    mask[valid] = diff[valid] >= threshold_mm
    mask = fill_small_gaps(mask, max(0, merge_gap_steps))
    mask &= valid

    return diff, regions_from_mask(mask, min_region_steps)


def main():
    parser = argparse.ArgumentParser(
        description="Detect bicycle-like regions by comparing LiDAR scans to references."
    )
    parser.add_argument(
        "folder", nargs="?", default=None,
        help="Project folder containing pos1 and pos2 (default: script folder)"
    )
    parser.add_argument(
        "--threshold-mm", type=float, default=THRESHOLD_MM,
        help=f"Minimum XY displacement from reference (default: {THRESHOLD_MM} mm)"
    )
    parser.add_argument(
        "--min-region-steps", type=int, default=MIN_REGION_STEPS,
        help=f"Minimum consecutive steps in a region (default: {MIN_REGION_STEPS})"
    )
    parser.add_argument(
        "--merge-gap-steps", type=int, default=MERGE_GAP_STEPS,
        help=f"Merge detections separated by at most this many steps (default: {MERGE_GAP_STEPS})"
    )
    parser.add_argument(
        "--block-size-mm", type=float, default=200,
        help="Size of square blocks to fit in each detected area (default: 200 mm)"
    )
    parser.add_argument(
        "--no-plot", action="store_true", help="Do not save diagnostic plots"
    )
    parser.add_argument(
        "--reference-harmonics",
        type=int,
        default=32,
        help="Smoothness of the fitted periodic reference (default: 32)",
    )
    parser.add_argument(
        "--esp32-header", default="lidar_reference_fit.h",
        help="C++ header filename for the fitted ESP32 reference",
    )

    args = parser.parse_args()

    folder = (Path(args.folder) if args.folder else Path(__file__).resolve().parent)
    folder = folder.expanduser().resolve()
    pos1 = folder / "pos1"
    pos2 = folder / "pos2"
    if not pos1.is_dir():
        raise SystemExit(f"Could not find reference directory: {pos1}")

    # Reference files live in pos1 and are identified by "ref" in the name.
    reference_candidates = sorted(
        p for p in pos1.glob("*.txt") if "ref" in p.name.lower()
    )
    if not reference_candidates:
        raise SystemExit(f"Could not find a *ref*.txt reference file in {pos1}")

    old_candidates = [
        p for p in reference_candidates if "newpos" not in p.name.lower()
    ]
    ref_old_path = old_candidates[0] if old_candidates else reference_candidates[0]
    new_candidates = [
        p for p in reference_candidates if "newpos" in p.name.lower()
    ]
    # If there is only one reference, use it for both data sets.
    ref_new_path = new_candidates[0] if new_candidates else ref_old_path

    old_ref = read_scan(ref_old_path)
    new_ref = read_scan(ref_new_path)
    max_step = max(max(old_ref), max(new_ref))

    old_ref_s = smooth_valid_segments(to_aligned_array(old_ref, max_step), SMOOTH_WINDOW)
    new_ref_s = smooth_valid_segments(to_aligned_array(new_ref, max_step), SMOOTH_WINDOW)

    # Process measurements from both data-set directories, excluding references.
    txt_files = sorted(pos1.glob("*.txt"))
    if pos2.is_dir():
        txt_files.extend(sorted(pos2.glob("*.txt")))
    measurements = []
    for path in txt_files:
        low = path.name.lower()
        if "ref" in low:
            continue
        try:
            # Classification deliberately uses the complete scan.  Do not
            # replace this with read_dataset(), whose XY points are trimmed
            # for visualization.
            parsed = read_scan(path)
        except ValueError:
            continue
        measurements.append((path, parsed))

    # Also classify each reference scan as a test run.  A reference compared
    # with itself should produce no bicycle regions and provides a basic
    # sanity check for the classification pipeline.
    measured_paths = {path for path, _ in measurements}
    for path in reference_candidates:
        if path in measured_paths:
            continue
        try:
            measurements.append((path, read_scan(path)))
        except ValueError:
            continue

    if not measurements:
        raise SystemExit("No measurement TXT files found alongside the reference files.")

    rows = []
    plot_payload = []

    for path, parsed in measurements:
        aligned = to_aligned_array(parsed, max_step)
        measured_s = smooth_valid_segments(aligned, SMOOTH_WINDOW)

        use_newpos = "newpos" in path.name.lower()
        reference_s = new_ref_s if use_newpos else old_ref_s
        reference_label = ref_new_path.name if use_newpos else ref_old_path.name

        valid = np.isfinite(measured_s) & np.isfinite(reference_s)
        step_numbers = np.arange(max_step + 1)
        measured_x, measured_y = polar_to_xy(step_numbers, measured_s)
        reference_x, reference_y = polar_to_xy(step_numbers, reference_s)
        diff = np.full(max_step + 1, np.nan, dtype=float)
        # Classify using Euclidean displacement between corresponding XY points,
        # rather than comparing only their radial distances.
        diff[valid] = np.hypot(
            measured_x[valid] - reference_x[valid],
            measured_y[valid] - reference_y[valid],
        )

        raw_mask = np.zeros(max_step + 1, dtype=bool)
        raw_mask[valid] = diff[valid] >= args.threshold_mm
        mask = fill_small_gaps(raw_mask, max(0, args.merge_gap_steps))
        mask &= valid
        regions = regions_from_mask(mask, args.min_region_steps)

        if not regions:
            rows.append({
                "file": path.name,
                "reference_used": reference_label,
                "classification": "no_bicycle",
                "bicycle_regions": 0,
                "region_number": 0,
                "start_step": "",
                "end_step": "",
                "width_steps": 0,
                "block_count": 0,
                "block_positions_mm": "",
                "max_xy_displacement_mm": (
                    round(float(np.nanmax(diff)), 1)
                    if np.isfinite(diff).any()
                    else ""
                ),
                "threshold_mm": args.threshold_mm,
                "note": "No region passed the current threshold/minimum-length settings"
            })
        else:
            for number, region in enumerate(regions, start=1):
                start, end = region
                block_positions = blocks_for_region(
                    region,
                    measured_s,
                    args.block_size_mm,
                )

                rows.append({
                    "file": path.name,
                    "reference_used": reference_label,
                    "classification": "bicycle",
                    "bicycle_regions": len(regions),
                    "region_number": number,
                    "start_step": start,
                    "end_step": end,
                    "width_steps": end - start + 1,
                    "block_count": len(block_positions),
                    "block_positions_mm": "; ".join(
                        f"({x:g}, {y:g})"
                        for x, y in block_positions
                    ),
                    "max_xy_displacement_mm": round(
                        float(np.nanmax(diff[start:end + 1])),
                        1,
                    ),
                    "threshold_mm": args.threshold_mm,
                    "note": "Candidate region; verify against labelled scans"
                })

        plot_payload.append((path, reference_label, measured_s, reference_s, diff, regions))

    csv_path = folder / "lidar_detection_results.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "file", "reference_used", "classification", "bicycle_regions",
            "region_number", "start_step", "end_step",
            "width_steps", "block_count", "block_positions_mm",
            "max_xy_displacement_mm", "threshold_mm", "note"
        ])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Reference (original position): {ref_old_path.name}")
    print(f"Reference (new position):      {ref_new_path.name}")
    print(f"Threshold: {args.threshold_mm:g} mm")
    print(f"Minimum region length: {args.min_region_steps} steps")
    print(f"Merge gap: {max(0, args.merge_gap_steps)} steps")
    print(f"Block size: {args.block_size_mm:g} mm (X limited to +/-{MAX_X_MM:g} mm)")
    print(f"Results saved to: {csv_path}")
    print("\nCandidate regions (step positions, not metres):")
    for path, reference_label, measured_s, reference_s, diff, regions in plot_payload:
        if regions:
            formatted = ", ".join(f"{a}-{b}" for a, b in regions)
            print(f"  {path.name}: BICYCLE ({len(regions)} region(s): {formatted})  [reference: {reference_label}]")
            for number, region in enumerate(regions, start=1):
                positions = blocks_for_region(region, measured_s, args.block_size_mm)
                formatted_positions = ", ".join(
                    f"({x:g}, {y:g})" for x, y in positions
                ) or "none"
                print(
                    f"    Region {number}: {len(positions)} block(s), "
                    f"centres in mm: {formatted_positions}"
                )
        else:
            print(f"  {path.name}: NO BICYCLE")

    # Second classification run: use fitted general references.
    old_fit = fit_periodic_reference(
        to_aligned_array(old_ref, max_step)
    )
    new_fit = fit_periodic_reference(
        to_aligned_array(new_ref, max_step)
    )

    old_coefficients = fit_periodic_coefficients(
        to_aligned_array(old_ref, max_step), args.reference_harmonics
    )
    new_coefficients = fit_periodic_coefficients(
        to_aligned_array(new_ref, max_step), args.reference_harmonics
    )
    esp32_header_path = folder / args.esp32_header
    write_esp32_reference_header(
        esp32_header_path,
        old_coefficients,
        new_coefficients,
        args.reference_harmonics,
    )
    print(f"ESP32 reference header saved to: {esp32_header_path}")

    fitted_rows = []
    fitted_plot_payload = []

    for path, parsed in measurements:
        measured_s = smooth_valid_segments(
            to_aligned_array(parsed, max_step),
            SMOOTH_WINDOW,
        )

        use_newpos = "newpos" in path.name.lower()
        fitted_reference = new_fit if use_newpos else old_fit
        reference_label = (
            "fitted_" + ref_new_path.name
            if use_newpos
            else "fitted_" + ref_old_path.name
        )

        fitted_diff, fitted_regions = classify_against_reference(
            measured_s,
            fitted_reference,
            max_step,
            args.threshold_mm,
            args.merge_gap_steps,
            args.min_region_steps,
        )

        if not fitted_regions:
            fitted_rows.append({
                "file": path.name,
                "reference_used": reference_label,
                "classification": "no_bicycle",
                "bicycle_regions": 0,
                "region_number": 0,
                "start_step": "",
                "end_step": "",
                "width_steps": 0,
                "block_count": 0,
                "block_positions_mm": "",
                "max_xy_displacement_mm": (
                    round(float(np.nanmax(fitted_diff)), 1)
                    if np.isfinite(fitted_diff).any()
                    else ""
                ),
                "threshold_mm": args.threshold_mm,
                "note": "Second run against fitted reference",
            })
        else:
            for number, region in enumerate(fitted_regions, start=1):
                start, end = region
                block_positions = blocks_for_region(
                    region,
                    measured_s,
                    args.block_size_mm,
                )

                fitted_rows.append({
                    "file": path.name,
                    "reference_used": reference_label,
                    "classification": "bicycle",
                    "bicycle_regions": len(fitted_regions),
                    "region_number": number,
                    "start_step": start,
                    "end_step": end,
                    "width_steps": end - start + 1,
                    "block_count": len(block_positions),
                    "block_positions_mm": "; ".join(
                        f"({x:g}, {y:g})"
                        for x, y in block_positions
                    ),
                    "max_xy_displacement_mm": round(
                        float(np.nanmax(fitted_diff[start:end + 1])),
                        1,
                    ),
                    "threshold_mm": args.threshold_mm,
                    "note": "Second run against fitted reference",
                })

        fitted_plot_payload.append((
            path,
            measured_s.copy(),
            fitted_reference.copy(),
            fitted_regions,
        ))

        formatted = ", ".join(
            f"{start}-{end}" for start, end in fitted_regions
        )
        print(
            f"Fitted-reference run - {path.name}: "
            f"{'BICYCLE' if fitted_regions else 'NO BICYCLE'}"
            f"{f' ({formatted})' if formatted else ''}"
        )

    fitted_csv_path = folder / "lidar_detection_results_fitted.csv"
    with fitted_csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "file", "reference_used", "classification",
            "bicycle_regions", "region_number", "start_step",
            "end_step", "width_steps", "block_count",
            "block_positions_mm", "max_xy_displacement_mm",
            "threshold_mm", "note",
        ])
        writer.writeheader()
        writer.writerows(fitted_rows)

    print(f"Fitted-reference results saved to: {fitted_csv_path}")

    if not args.no_plot and PLOT_RESULTS:
        try:
            import matplotlib.pyplot as plt

            for path, measured_s, fitted_reference, fitted_regions in fitted_plot_payload:
                vl_steps, vl_x, vl_y, us_x, us_y = read_dataset(path)

                detected = np.zeros(max_step + 1, dtype=bool)
                for start, end in fitted_regions:
                    detected[start:end + 1] = True

                step_indices = vl_steps.astype(int)
                classified = (
                    (step_indices >= 0)
                    & (step_indices <= max_step)
                    & detected[step_indices]
                )

                steps = np.arange(max_step + 1)
                fit_x, fit_y = polar_to_xy(steps, fitted_reference)
                fit_valid = np.isfinite(fitted_reference)

                # Convert millimetres to metres and plot absolute Y values.
                fit_x = fit_x / 1000.0
                fit_y = np.clip(np.abs(fit_y) / 1000.0, 0, None)
                vl_x = vl_x / 1000.0
                vl_y = np.clip(np.abs(vl_y) / 1000.0, 0, None)
                us_x = us_x / 1000.0
                us_y = np.clip(np.abs(us_y) / 1000.0, 0, None)

                # Export only measurement points and their classification.
                points_path = folder / f"{path.stem}_plotted_points.txt"
                with points_path.open("w", encoding="utf-8") as points_file:
                    points_file.write("step,x_m,abs_y_m,classified\n")

                    for step, x, y, is_classified in zip(
                        vl_steps, vl_x, vl_y, classified
                    ):
                        points_file.write(
                            f"{int(step)},{x:.6f},{y:.6f},"
                            f"{bool(is_classified)}\n"
                        )

                fig, ax = plt.subplots(figsize=(11, 8))
                ax.set_aspect("equal", adjustable="box")
                ax.grid(True, alpha=0.25)

                ax.set_xlabel("X (m)", fontsize=16)
                ax.set_ylabel("|Y| (m)", fontsize=16)
                ax.set_title(
                    f"Fitted-reference classification - {path.stem}",
                    fontsize=18,
                )
                ax.tick_params(axis="both", labelsize=14)

                ax.scatter(
                    fit_x[fit_valid],
                    fit_y[fit_valid],
                    s=8,
                    color="black",
                    alpha=0.35,
                    label="Fitted reference",
                )

                ax.scatter(
                    vl_x,
                    vl_y,
                    s=12,
                    color="tab:blue",
                    alpha=0.45,
                    label="Measurement",
                )

                if np.any(classified):
                    ax.scatter(
                        vl_x[classified],
                        vl_y[classified],
                        s=32,
                        color="red",
                        zorder=3,
                        label="Classified bicycle",
                    )

                if us_x.size:
                    ax.scatter(
                        us_x,
                        us_y,
                        s=12,
                        marker="x",
                        color="tab:orange",
                        label="Ultrasonic",
                    )

                ax.scatter(
                    [0], [0],
                    marker="+",
                    s=70,
                    color="black",
                    label="Sensor",
                )

                all_values = np.concatenate((
                    fit_x[fit_valid],
                    fit_y[fit_valid],
                    vl_x,
                    vl_y,
                    us_x,
                    us_y,
                ))
                if all_values.size:
                    limit = max(0.1, float(np.max(np.abs(all_values))) * 1.1)
                    ax.set_xlim(-limit, limit)
                    ax.set_ylim(0, limit)  # Clip the plot at Y = 0

                ax.legend(
                    loc="upper left",
                    bbox_to_anchor=(1.01, 1),
                    fontsize=12,
                )
                fig.tight_layout()

                output_path = folder / f"{path.stem}_fitted_detection.png"
                fig.savefig(output_path, dpi=140)
                plt.close(fig)

        except ImportError:
            print(
                "matplotlib not installed; skipped fitted plots. "
                "Install with: pip install matplotlib"
            )


if __name__ == "__main__":
    main()




