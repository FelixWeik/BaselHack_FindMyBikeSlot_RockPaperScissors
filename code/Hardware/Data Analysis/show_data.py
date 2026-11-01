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
LINE_PATTERN = re.compile(
	r"Step\s+(\d+)\s*:\s*VL53L1X\s*=\s*([\d.]+)\s*mm\s*,\s*"
	r"Ultrasonic\s*=\s*([\d.]+)\s*cm",
	re.IGNORECASE,
)


DATA_PATH = Path("C:/Users/NynferidE14/Documents/PlatformIO/Projects/ESP32_Cam_Test_V1/pos2/2026-10-31_17-20-10-209430_ref_newpos.txt")


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
	vl53_mask = (vl53 <= MAX_DISTANCE_MM) & (np.abs(vl53_x) <= MAX_X_MM)
	ultrasonic_mask = ((ultrasonic <= MAX_DISTANCE_MM)
					   & (np.abs(ultrasonic_x) <= MAX_X_MM))
	print(f"{path.name} VL53 steps for X +/-{MAX_X_MM} mm: "
		  f"{steps[vl53_mask].tolist()}")
	print(f"{path.name} Ultrasonic steps for X +/-{MAX_X_MM} mm: "
		  f"{steps[ultrasonic_mask].tolist()}")
	return (-vl53[vl53_mask] * np.sin(angle[vl53_mask]),
			-vl53[vl53_mask] * np.cos(angle[vl53_mask]),
			-ultrasonic[ultrasonic_mask] * np.sin(angle[ultrasonic_mask]),
			-ultrasonic[ultrasonic_mask] * np.cos(angle[ultrasonic_mask]))


def main():
	log_directory = Path(__file__).resolve().parent / "Logs"
	log_files = sorted(log_directory.glob("*.txt"))
	for path in log_files:
		data = read_dataset(path)
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
			finite_data = np.concatenate(data)
			maximum = max(100, float(np.max(np.abs(finite_data))) * 1.1) \
				if finite_data.size else 100
		else:
			maximum = 100

		axis.set_xlim(-maximum, maximum)
		axis.set_ylim(-maximum, maximum)
		axis.set_title(f"ESP32 Radar XY - {path.stem}")
		axis.legend(loc="upper left", bbox_to_anchor=(1.01, 1), fontsize=7)
	plt.show()


if __name__ == "__main__":
	main()
