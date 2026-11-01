"""Live polar plot for the ESP32 radar on COM11."""

import re
from collections import deque
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from threading import Event, Thread

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import numpy as np

try:
	import serial
except ImportError as error:
	raise SystemExit(
		"PySerial is required. Install it with: python -m pip install pyserial"
	) from error

if not hasattr(serial, "Serial"):
	raise SystemExit(
		"The wrong 'serial' package is installed. Run: "
		"python -m pip uninstall serial, then python -m pip install pyserial"
	)


PORT = "COM11"
BAUD_RATE = 115200
# The motor uses 6400 steps per revolution for angle conversion.
STEPS_PER_REVOLUTION = 6400
SCAN_ANGLE_DEGREES = 170
SCAN_STEPS = STEPS_PER_REVOLUTION * SCAN_ANGLE_DEGREES / 360

LINE_PATTERN = re.compile(
	r"Step\s+(\d+)\s*:\s*VL53L1X\s*=\s*([\d.]+)\s*mm\s*,\s*"
	r"Ultrasonic\s*=\s*([\d.]+)\s*cm",
	re.IGNORECASE,
)


def main():
	serial_port = serial.Serial(PORT, BAUD_RATE, timeout=0.05)
	serial_port.reset_input_buffer()
	log_directory = Path(__file__).resolve().parent / "logs"
	log_directory.mkdir(exist_ok=True)
	measurement_queue = Queue()
	stop_reader = Event()
	scans = deque(maxlen=100)  # Completed scans are retained for the plot.
	current_scan = []

	def read_serial():
		"""Read and log every serial line without blocking the plot."""
		nonlocal serial_port
		log_file = None
		previous_step = None
		try:
			def new_log_file():
				log_name = datetime.now().strftime("%Y-%m-%d_%H-%M-%S-%f.txt")
				return (log_directory / log_name).open("w", encoding="utf-8")

			log_file = new_log_file()
			while not stop_reader.is_set():
				try:
					raw_line = serial_port.readline()
				except (serial.SerialException, OSError) as error:
					print(f"Serial connection lost: {error}. Retrying...")
					try:
						serial_port.close()
					except (serial.SerialException, OSError):
						pass
					if stop_reader.wait(1.0):
						break
					try:
						serial_port = serial.Serial(PORT, BAUD_RATE, timeout=0.05)
						serial_port.reset_input_buffer()
						previous_step = None
						raw_line = b""
					except (serial.SerialException, OSError) as reconnect_error:
						print(f"Serial reconnect failed: {reconnect_error}")
						continue
				if not raw_line:
					continue
				line = raw_line.decode("utf-8", errors="replace")
				match = LINE_PATTERN.search(line)
				step = int(match.group(1)) if match else None

				# Start a new file for each sweep, while preserving every line.
				if (step is not None and previous_step is not None
						and step < previous_step):
					log_file.close()
					log_file = new_log_file()
				log_file.write(line.rstrip("\r\n") + "\n")
				log_file.flush()

				if match:
					measurement_queue.put(match.groups())
					previous_step = step
		finally:
			if log_file is not None:
				log_file.close()

	reader_thread = Thread(target=read_serial, name="radar-serial-reader",
						  daemon=True)
	reader_thread.start()

	figure, axis = plt.subplots(subplot_kw={"projection": "polar"})
	old_vl53 = axis.scatter([], [], s=8, c="tab:blue", alpha=0.35,
							label="VL53L1X (old scans)")
	old_ultrasonic = axis.scatter([], [], s=8, c="tab:orange", alpha=0.35,
								  label="Ultrasonic (old scans)")
	live_vl53 = axis.scatter([], [], s=22, c="blue", label="VL53L1X (current)")
	live_ultrasonic = axis.scatter([], [], s=22, c="orange",
								   label="Ultrasonic (current)")
	axis.set_theta_zero_location("N")
	axis.set_theta_direction(-1)
	axis.set_title("ESP32 Radar - waiting for data")
	axis.legend(loc="upper right", bbox_to_anchor=(1.25, 1.12))

	xy_figure, xy_axis = plt.subplots()
	xy_old_vl53 = xy_axis.scatter([], [], s=8, c="tab:blue", alpha=0.35,
								  label="VL53L1X (old scans)")
	xy_old_ultrasonic = xy_axis.scatter([], [], s=8, c="tab:orange", alpha=0.35,
										label="Ultrasonic (old scans)")
	xy_live_vl53 = xy_axis.scatter([], [], s=22, c="blue",
									label="VL53L1X (current)")
	xy_live_ultrasonic = xy_axis.scatter([], [], s=22, c="orange",
										 label="Ultrasonic (current)")
	xy_axis.scatter([0], [0], s=45, c="black", marker="+", label="Radar")
	xy_axis.set_xlabel("X (mm)")
	xy_axis.set_ylabel("Y (mm)")
	xy_axis.set_title("ESP32 Radar XY - waiting for data")
	xy_axis.set_aspect("equal", adjustable="box")
	xy_axis.grid(True)
	xy_axis.legend(loc="upper right")

	def update(_frame):
		nonlocal current_scan
		last_step = current_scan[-1][0] if current_scan else None
		while True:
			try:
				step, vl53_mm, ultrasonic_cm = measurement_queue.get_nowait()
			except Empty:
				break

			step = int(step)
			print(f"Step {step}: VL53L1X = {vl53_mm} mm, Ultrasonic = {ultrasonic_cm} cm")
			point = (step, float(vl53_mm), float(ultrasonic_cm) * 10.0)

			# A reset or a missed step can make the next sweep begin at any
			# lower step number, so do not rely only on step zero.
			if (current_scan and last_step is not None
					and step <= last_step):
				scans.append(current_scan)
				current_scan = []
			current_scan.append(point)
			last_step = step

		if not current_scan:
			return

		def coordinates(scan):
			steps = np.array([p[0] for p in scan])
			# The middle of the 120-degree sweep points straight up.
			angles = (np.pi / 2
					  + (steps - SCAN_STEPS / 2) * 2 * np.pi
					  / STEPS_PER_REVOLUTION)
			vl53 = np.array([p[1] for p in scan])
			ultrasonic = np.array([p[2] for p in scan])
			return angles, vl53, ultrasonic

		old_angles, old_vl, old_us = [], [], []
		for scan in scans:
			angles, vl53, ultrasonic = coordinates(scan)
			old_angles.extend(angles)
			old_vl.extend(vl53)
			old_us.extend(ultrasonic)
		angles, vl53, ultrasonic = coordinates(current_scan)

		# Step zero points left on the X axis.  Increasing steps rotate
		# clockwise from that direction, with the radar at (0, 0).
		def xy_coordinates(scan):
			steps = np.array([p[0] for p in scan])
			angle = ((steps - SCAN_STEPS / 2) * 2 * np.pi
					 / STEPS_PER_REVOLUTION)
			vl53_distance = np.array([p[1] for p in scan])
			ultrasonic_distance = np.array([p[2] for p in scan])
			return (
				-vl53_distance * np.sin(angle),
				-vl53_distance * np.cos(angle),
				-ultrasonic_distance * np.sin(angle),
				-ultrasonic_distance * np.cos(angle),
			)

		old_xy_vl_x, old_xy_vl_y = [], []
		old_xy_us_x, old_xy_us_y = [], []
		for scan in scans:
			vl_x, vl_y, us_x, us_y = xy_coordinates(scan)
			old_xy_vl_x.extend(vl_x)
			old_xy_vl_y.extend(vl_y)
			old_xy_us_x.extend(us_x)
			old_xy_us_y.extend(us_y)
		vl_x, vl_y, us_x, us_y = xy_coordinates(current_scan)

		old_vl53.set_offsets(np.column_stack((old_angles, old_vl))
							  if old_angles else np.empty((0, 2)))
		old_ultrasonic.set_offsets(np.column_stack((old_angles, old_us))
								   if old_angles else np.empty((0, 2)))
		live_vl53.set_offsets(np.column_stack((angles, vl53)))
		live_ultrasonic.set_offsets(np.column_stack((angles, ultrasonic)))
		xy_old_vl53.set_offsets(np.column_stack((old_xy_vl_x, old_xy_vl_y))
								if old_xy_vl_x else np.empty((0, 2)))
		xy_old_ultrasonic.set_offsets(
			np.column_stack((old_xy_us_x, old_xy_us_y))
			if old_xy_us_x else np.empty((0, 2)))
		xy_live_vl53.set_offsets(np.column_stack((vl_x, vl_y)))
		xy_live_ultrasonic.set_offsets(np.column_stack((us_x, us_y)))
		axis.set_ylim(0, max(100, max(vl53.max(), ultrasonic.max()) * 1.1))
		axis.set_title(f"ESP32 Radar - step {current_scan[-1][0]}")
		xy_limit = max(100, max(vl53.max(), ultrasonic.max()) * 1.1)
		xy_axis.set_xlim(-xy_limit, xy_limit)
		xy_axis.set_ylim(-xy_limit, xy_limit)
		xy_axis.set_title(f"ESP32 Radar XY - step {current_scan[-1][0]}")
		xy_figure.canvas.draw_idle()

	animation = FuncAnimation(figure, update, interval=30, cache_frame_data=False)
	try:
		plt.show()
	finally:
		animation.event_source.stop()
		stop_reader.set()
		serial_port.close()
		reader_thread.join(timeout=1.0)


if __name__ == "__main__":
	main()
