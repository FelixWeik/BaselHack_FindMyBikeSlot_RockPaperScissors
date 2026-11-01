"""Display all radar scans saved by the live serial plotter."""

import re
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


STEPS_PER_REVOLUTION = 6400
SCAN_ANGLE_DEGREES = 170
SCAN_STEPS = STEPS_PER_REVOLUTION * SCAN_ANGLE_DEGREES / 360
MAX_DISTANCE_MM = 3100
MAX_X_MM = 2000
POLYNOMIAL_DEGREE = 3
LINE_PATTERN = re.compile(
	r"Step\s+(\d+)\s*:\s*VL53L1X\s*=\s*([\d.]+)\s*mm\s*,\s*"
	r"Ultrasonic\s*=\s*([\d.]+)\s*cm",
	re.IGNORECASE,
)

DATA_PATH = Path("C:/Users/NynferidE14/Documents/PlatformIO/Projects/""ESP32_Cam_Test_V1/pos2/2026-10-31_17-20-10-209430_ref_newpos.txt")


def polynomial_curve(x_values, y_values, degree=POLYNOMIAL_DEGREE):
	"""Return x coordinates and a polynomial fit for finite point pairs."""
	finite = np.isfinite(x_values) & np.isfinite(y_values)
	finite_x = x_values[finite]
	finite_y = y_values[finite]
	if np.count_nonzero(finite) <= degree or np.unique(finite_x).size <= degree:
		return np.array([]), np.array([])

	try:
		coefficients = np.polyfit(finite_x, finite_y, degree)
	except (np.linalg.LinAlgError, ValueError):
		return np.array([]), np.array([])
	x_fit = np.linspace(np.min(finite_x), np.max(finite_x), 300)
	return x_fit, np.polyval(coefficients, x_fit)


def report_fit(name, x_values, y_values, degree=POLYNOMIAL_DEGREE):
	"""Print the polynomial coefficients and root-mean-square fit error."""
	finite = np.isfinite(x_values) & np.isfinite(y_values)
	finite_x = x_values[finite]
	finite_y = y_values[finite]
	if (finite_y.size <= degree or np.unique(finite_x).size <= degree):
		return

	coefficients = np.polyfit(finite_x, finite_y, degree)
	residuals = finite_y - np.polyval(coefficients, finite_x)
	terms = []
	for index, coefficient in enumerate(coefficients):
		power = degree - index
		if power == 0:
			terms.append(f"{coefficient:.6g}")
		elif power == 1:
			terms.append(f"{coefficient:.6g}*x")
		else:
			terms.append(f"{coefficient:.6g}*x^{power}")
	print(f"{name}: y = {' + '.join(terms)}; RMSE = "
		  f"{np.sqrt(np.mean(residuals ** 2)):.2f} mm")


def read_dataset(path):
	points = []
	for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
		match = LINE_PATTERN.search(line)
		if match:
			points.append((int(match.group(1)), float(match.group(2)),
						   float(match.group(3)) * 10))
	if not points:
		return (np.array([]),) * 4

	steps = np.array([point[0] for point in points])
	angle = ((steps - SCAN_STEPS / 2) * 2 * np.pi
			 / STEPS_PER_REVOLUTION)
	vl53 = np.array([point[1] for point in points])
	ultrasonic = np.array([point[2] for point in points])
	vl53_x = -vl53 * np.sin(angle)
	ultrasonic_x = -ultrasonic * np.sin(angle)
	vl53_distance_clip = vl53 > MAX_DISTANCE_MM
	vl53_x_clip = np.abs(vl53_x) > MAX_X_MM
	ultrasonic_distance_clip = ultrasonic > MAX_DISTANCE_MM
	ultrasonic_x_clip = np.abs(ultrasonic_x) > MAX_X_MM
	vl53_mask = ~(vl53_distance_clip | vl53_x_clip)
	ultrasonic_mask = ~(ultrasonic_distance_clip | ultrasonic_x_clip)

	def report_clipped(name, distances, x_values, distance_clip, x_clip):
		clipped = distance_clip | x_clip
		#print(f"{path.name} {name} clipped spots:")
		if not np.any(clipped):
			#print("  none")
			return
		for step, distance, x_value, over_distance, outside_x in zip(
				steps[clipped], distances[clipped], x_values[clipped],
				distance_clip[clipped], x_clip[clipped]):
			reasons = []
			if over_distance:
				reasons.append(f"distance {distance:.1f} mm > {MAX_DISTANCE_MM} mm")
			if outside_x:
				reasons.append(f"X {x_value:.1f} mm outside +/-{MAX_X_MM} mm")
			#print(f"  step {step}: {', '.join(reasons)}")

	report_clipped("VL53", vl53, vl53_x, vl53_distance_clip, vl53_x_clip)
	report_clipped("Ultrasonic", ultrasonic, ultrasonic_x,
				   ultrasonic_distance_clip, ultrasonic_x_clip)
	return (-vl53[vl53_mask] * np.sin(angle[vl53_mask]),
			-vl53[vl53_mask] * np.cos(angle[vl53_mask]),
			-ultrasonic[ultrasonic_mask] * np.sin(angle[ultrasonic_mask]),
			-ultrasonic[ultrasonic_mask] * np.cos(angle[ultrasonic_mask]))


def main():
	if not DATA_PATH.is_file():
		raise FileNotFoundError(f"Radar scan file not found: {DATA_PATH}")

	data = read_dataset(DATA_PATH)
	figure, axis = plt.subplots(figsize=(11, 8))
	axis.set_aspect("equal", adjustable="box")
	axis.set_xlabel("X (mm)")
	axis.set_ylabel("Y (mm)")
	axis.grid(True)
	axis.scatter([0], [0], marker="+", s=70, c="black", label="Radar")

	if data[0].size:
		vl_x, vl_y, us_x, us_y = data
		axis.scatter(vl_x, vl_y, s=12, marker="o", label="VL53")
		axis.scatter(us_x, us_y, s=12, marker="x", label="Ultrasonic")
		fit_data = []
		for x_values, y_values, color, name in (
				(vl_x, vl_y, "tab:blue", "VL53 polynomial"),
				(us_x, us_y, "tab:orange", "Ultrasonic polynomial")):
			report_fit(name, x_values, y_values)
			x_fit, y_fit = polynomial_curve(x_values, y_values)
			if x_fit.size:
				axis.plot(x_fit, y_fit, color=color, linestyle="--",
						  linewidth=2.5, label=f"{name} fit", zorder=3)
				fit_data.extend((x_fit, y_fit))
		finite_data = np.concatenate(data + tuple(fit_data))
		maximum = max(100, float(np.max(np.abs(finite_data))) * 1.1) \
			if finite_data.size else 100
	else:
		maximum = 100

	axis.set_xlim(-maximum, maximum)
	axis.set_ylim(-maximum, maximum)
	axis.set_title(f"ESP32 Radar XY - {DATA_PATH.stem}")
	axis.legend(loc="upper left", bbox_to_anchor=(1.01, 1), fontsize=7)
	plt.show()


if __name__ == "__main__":
	main()