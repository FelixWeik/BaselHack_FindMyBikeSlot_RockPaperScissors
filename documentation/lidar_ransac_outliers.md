# RANSAC Outlier Detection for VL53L1X LIDAR

Robust outlier detection for the VL53L1X time-of-flight LIDAR sensor data using a two-stage RANSAC approach, displayed in both step-distance space and radar XY view. The ESP32 scans a 170° arc, producing a parabola in (step, distance) space that maps to an arc in radar XY coordinates. Outliers appear as straight lines deviating from the parabola/arc.

## Approach

The VL53L1X LIDAR data forms a 2nd-degree parabola in (step, distance) space:

```
distance = a·step² + b·step + c
```

Outliers (e.g., from edge reflections or scanning past obstacles) show up as straight lines that break the parabolic shape. The detector uses **two-stage RANSAC**:

### Stage 1 - RANSAC Quadratic Fit

- Fits a quadratic parabola using `RANSACRegressor` with `PolynomialFeatures(degree=2)`
- Parameters: `min_samples=0.55`, `residual_threshold=250.0mm`, `max_trials=500`, `random_state=42`
- This finds the dominant parabolic shape, tolerating noise (median residual 50-100mm) and the noisier edges

### Stage 2 - Robust Adaptive Threshold

- Computes residuals for all points against the fitted parabola
- Estimates noise via the **MAD** (Median Absolute Deviation) of RANSAC inliers:
  - `threshold = median(residuals_inliers) + 6 × MAD`
- Flags points with residuals above this adaptive threshold as outliers

## Usage

```bash
# Process all files in assets/lidarData/
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py

# Process a specific file
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py assets/lidarData/2026-10-31_14-43-19-810460.txt

# Custom parameters
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py --minsamples 0.6 --ransac-thresh 300 --mad-mult 8

# Optional max-distance filter (default: show ALL points)
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py --max-distance 2500

# Validate that all outliers are visible in the radar plots
.venv/bin/python validate_radar_view.py
```

## Output

- **Console**: outlier counts, step segments, fitted parabola coefficients & vertex, summary table
- **Plots**: quarter-wave radar XY plot (saved to `output/*_radar_ransac.png`)
  - **Green dots**: RANSAC inliers (bike rack / wall)
  - **Red X**: detected outliers (edges / obstacles)

All points are plotted by **default** — no `MAX_DISTANCE_MM` filter is applied, so outliers at any distance remain visible.

## Validation Results

| File | Points | Outliers | % | Threshold | Visible Outliers |
|------|--------|----------|-------|-----------|-----------------|
| `2026-10-31_14-13-55-328885.txt` | 3022 | 217 | 7.2% | 265mm | 217 (100%) |
| `2026-10-31_14-18-41-931469.txt` | 3022 | 61 | 2.0% | 393mm | 61 (100%) |
| `2026-10-31_14-43-19-810460.txt` | 2805 | 171 | 6.1% | 284mm | 171 (100%) |

All outliers are fully visible in the radar view (no hidden points).

## Key Outlier Segments

- **File 1 (14-13-55)**: steps 1-81 (34), 488-523 (19), 535-735 (120), 746-773 (11)
- **File 2 (14-18-41)**: steps 2097-2213 (26), 2756-2900 (33)
- **File 3 (14-43-19)**: steps 1-139 (131), 308-325 (15), 2771-2804 (13)

## Files

| File | Purpose |
|------|---------|
| `code/backend/lidar/lidar_ransac_radar_view.py` | Main combined script (RANSAC + radar view) |
| `validate_radar_view.py` | Validation script ensuring all outliers are visible |
| `output/*_radar_ransac.png` | Generated radar XY plots with outliers marked |

## Dependencies

```bash
pip install scikit-learn numpy matplotlib
```
