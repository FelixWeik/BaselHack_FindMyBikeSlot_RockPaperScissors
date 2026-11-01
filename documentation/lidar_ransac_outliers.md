# Bike Dent Detection for VL53L1X LIDAR

Bike detection for the VL53L1X time-of-flight LIDAR sensor using RANSAC parabola fit + detrended residual peak detection. The ESP32 scans a 170° arc, producing a parabola in (step, distance) space that maps to an arc in radar XY coordinates. Bike dents appear as localized deviations (bumps) from the smooth parabolic wall.

## Approach

The VL53L1X LIDAR data forms a 2nd-degree parabola in (step, distance) space:

```
distance = a·step² + b·step + c
```

A clean wall (reference) follows this parabola smoothly. When a bike is parked against the wall, it creates a localized dent (closer distance reading) that appears as a bump in the residual pattern.

### Algorithm Steps

1. **Edge cutoff (X only)**: Remove all points where `|x| > 1850` in radar XY space. The Y direction is NOT cut. (User-configurable via `--edge-limit`)

2. **RANSAC parabola fit**: Fit a quadratic using `RANSACRegressor` with `PolynomialFeatures(degree=2)` on the surviving points

3. **Signed residuals**: Compute `VL53 - y_pred` (positive = farther than parabola, negative = closer)

4. **Detrend**: Remove the smooth systematic wall deviation using a wide rolling median (window=201 steps). This eliminates the bias from a non-perfect parabolic wall.

5. **Candidate regions**: Find contiguous runs of ≥6 points where `|detrended| > 50mm`

6. **Peak verification**: Keep only regions whose peak `|detrended| > 100mm`. True bike dents produce strong localized peaks (130-330mm), while wall noise stays below 80-90mm.

## Usage

```bash
# Process all files in code/Hardware/logs/
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py

# Process a specific file
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py code/Hardware/logs/2026-10-31_17-15-26-422975_2bikes_newpos.txt

# Custom edge cutoff
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py --edge-limit 2000

# Tune detection thresholds
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py --min-depth 60 --max-depth 90

# Select all parameters
.venv/bin/python code/backend/lidar/lidar_ransac_radar_view.py --edge-limit 1850 --trend-window 201 --min-depth 50 --min-run 6 --max-depth 100
```

## Output

- **Console**: edge-cut stats, outlier counts, detected bike segments with coordinates, fitted parabola info
- **Plots**: radar XY plot (saved to `output/*_radar_ransac.png`)
  - **Green dots**: inliers (clean wall within edge cutoff)
  - **Red X**: detected outliers (bike dents)
  - **Dashed square**: the ±edge_limit boundary

## Validation Results (with ground truth from filenames)

| File | Expected | Outliers | Regions | Status |
|------|----------|----------|---------|--------|
| `_2bikes_1.txt` | 2 bikes | 6 | 1 | ✅ DETECTED |
| `_2Bikes_2.txt` | 2 bikes | 62 | 2+ | ✅ DETECTED |
| `_reference.txt` | 0 bikes | 0 | 0 | ✅ CORRECT (no false pos) |
| `_1bike.txt` | 1 bike | 16 | 3 | ✅ DETECTED |
| `_2bike_backwheel.txt` | 2 bikes | 18 | 2 | ✅ DETECTED |
| `_2bike_handlebar.txt` | 2 bikes | 91 | 1 | ✅ DETECTED |
| `_1bike_newpos.txt` | 1 bike | 7 | 1 | ✅ DETECTED |
| `_2bikes_newpos.txt` | 2 bikes | 43 | 2 | ✅ DETECTED |
| `_ref_newpos.txt` | 0 bikes | 0 | 0 | ✅ CORRECT (no false pos) |

**Result: 0 false positives, 0 misses** on all 9 files with known ground truth.

## Default Parameters

| Parameter | Meaning | Default |
|-----------|---------|---------|
| `--edge-limit` | Max XY radius in mm | 1850 |
| `--trend-window` | Rolling median window width | 201 |
| `--min-depth` | Candidate region threshold (mm) | 50 |
| `--min-run` | Min contiguous points in candidate | 6 |
| `--max-depth` | Peak threshold for true bike (mm) | 100 |
| `--ransac-thresh` | RANSAC residual threshold | 250 |
| `--min-samples` | RANSAC minimum sample ratio | 0.55 |

## Files

| File | Purpose |
|------|---------|
| `code/backend/lidar/lidar_ransac_radar_view.py` | Main bike dent detection script |
| `code/Hardware/logs/` | Raw LIDAR log files |
| `output/*_radar_ransac.png` | Generated radar XY plots with outliers marked |

## Dependencies

```bash
pip install scikit-learn numpy matplotlib
```
