import csv
from pathlib import Path

import matplotlib.pyplot as plt


DATA_FILE = Path(
	r"C:\Users\NynferidE14\Documents\PlatformIO\Projects\ESP32_Cam_Test_V1\presentation.txt"
)


def main():
	with DATA_FILE.open("r", encoding="utf-8-sig", newline="") as file:
		rows = list(csv.DictReader(file))

	if not rows:
		raise ValueError(f"No data found in {DATA_FILE}")

	x = [float(row["x_m"]) for row in rows]
	raw_y = [float(row["abs_y_m"]) for row in rows]
	y = [max(raw_y) - value for value in raw_y]
	classified = [row.get("classified", "").strip().lower() == "true" for row in rows]
	figure, points_axis = plt.subplots(figsize=(11, 7))

	points_axis.scatter(x, y, color="steelblue", s=25, label="Unclassified")
	points_axis.scatter(
		0,
		2,
		color="darkorange",
		s=100,
		marker="^",
		edgecolors="black",
		linewidths=0.8,
		label="Radar",
	)
	object_ranges = [
		("Bobby\ncar", -1.15, -0.82, "darkorange"),
		("Bike", 0.6, 1.1, "mediumseagreen"),
		("Wagon", 1.5, 1.9, "orchid"),
	]
	for object_name, start, end, color in object_ranges:
		points_axis.axvspan(start, end, color=color, alpha=0.35, zorder=0)
		points_axis.text(
			(start + end) / 2,
			0.5,
			object_name,
			transform=points_axis.get_xaxis_transform(),
			ha="center",
			va="center",
			fontsize=18,
			fontweight="bold",
			rotation=90,
			bbox={"facecolor": "white", "alpha": 0.7, "edgecolor": "none"},
		)
	if any(classified):
		classified_x = [value for value, is_classified in zip(x, classified) if is_classified]
		classified_y = [value for value, is_classified in zip(y, classified) if is_classified]
		points_axis.scatter(
			classified_x,
			classified_y,
			color="crimson",
			s=35,
			label="Classified",
		)
	points_axis.set_ylabel("Height", fontsize=16)
	points_axis.set_title("Measured Data", fontsize=20, fontweight="bold")
	points_axis.grid(alpha=0.3)
	points_axis.set_xlabel("Width", fontsize=16)
	points_axis.tick_params(axis="both", labelsize=14)

	figure.tight_layout()
	plt.show()


if __name__ == "__main__":
	main()
