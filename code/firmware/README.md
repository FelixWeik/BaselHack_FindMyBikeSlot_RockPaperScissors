# Camera node firmware

Each camera node captures a JPEG every second and sends it over WiFi to the vision service.
Nothing is stored on the device: a frame only lives in the camera frame buffer until it is sent.

```
Camera node (this project) ──JPEG, HTTP POST──▶ vision service :8001/api/v1/frames
```

## Hardware

- **Seeed XIAO ESP32S3 Sense** with the camera module attached (OV3660 sensor)
- **External WiFi antenna (required).** Without it the signal is around −90 dBm and the board cannot
  connect. Plug it into the small U.FL connector on the shielded side, opposite the USB-C port.
- USB-C data cable for flashing, USB power supply or power bank in the field

## Setup

```bash
# 1. Install PlatformIO
uv tool install platformio          # or: pip install platformio

# 2. Linux only: serial port access
sudo usermod -aG dialout $USER      # log out and back in, or run: newgrp dialout

# 3. Credentials (git-ignored)
cp include/secrets.h.example include/secrets.h
#    then set WiFi SSID, WiFi password and an OTA password
```

Check `include/config.h`: `DEVICE_ID` must be unique per camera, and `VISION_FALLBACK_IP` should be
the IP of the machine running the vision service (`ip -4 addr`).

## Build, flash, monitor

Run all `pio` commands from `code/firmware/`.

```bash
pio run -t upload                   # flash over USB
pio device monitor                  # serial log (Ctrl+C to quit)

pio run -e xiao_s3_ota -t upload    # flash over WiFi; set upload_port in platformio.ini to the camera IP
```

Expected log:

```
=== Camera 'cam-memox-nord' booting (reset reason: power on) ===
Camera ready: sensor PID 0x3660 ...
WiFi connected: IP 192.168.21.63, gateway 192.168.20.1, RSSI -52 dBm
OTA ready: ...
Frame: 13051 bytes -> HTTP 200 (82 ms) | RSSI -55 dBm | consecutive failures: 0
```

## Testing without the vision service

A minimal receiver (Python standard library only) accepts frames and shows the latest one per camera
in the browser. Frames are kept in memory only.

```bash
python3 tools/test_receiver.py
# preview: http://localhost:8001/
```

## LED states

| LED | Meaning |
|---|---|
| short flash every 1 s | frame delivered |
| fast blinking | connecting to WiFi |
| steady on | last attempt failed (vision service down? wrong IP?) |

## Self-recovery

The node is designed to run unattended for days.

| Problem | Reaction |
|---|---|
| main loop hangs for 30 s | watchdog restart |
| 10 consecutive failed captures/uploads | restart |
| WiFi lost | reconnect; restart after 60 s without WiFi |
| camera init fails | restart after 10 s |

The reset reason is logged at boot (e.g. `watchdog` or `brownout` → use a stronger power supply/cable).

OTA updates are password-protected. A wrong password is only logged and never causes a restart, so
nobody on the network can reboot a camera.

## Interface

```
POST http://<vision-host>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-memox-nord      camera name (config.h)
X-RSSI: -55                      WiFi signal in dBm
X-Uptime-S: 1234                 seconds since boot
Body: JPEG, 640x480
```

`200` means delivered; any other response counts as a failure. See [`documentation/api.md`](../../documentation/api.md).

## Configuration (`include/config.h`)

| Setting | Default | Purpose |
|---|---|---|
| `DEVICE_ID` | `cam-memox-nord` | camera name, unique per camera |
| `VISION_HOSTNAME` / `VISION_FALLBACK_IP` | `tempestD` / `192.168.22.2` | target host: mDNS (`.local`) first, then static IP |
| `FRAME_SIZE` | `FRAMESIZE_VGA` (640×480) | resolution |
| `JPEG_QUALITY` | `10` | 0..63, lower = sharper but larger |
| `CAMERA_VFLIP` / `CAMERA_HMIRROR` | `1` / `0` | flip/mirror depending on mounting |
| `CAPTURE_INTERVAL_MS` | `1000` | time between frames |

## Troubleshooting

| Message / symptom | Cause | Fix |
|---|---|---|
| `Not a PlatformIO project` | wrong directory | `cd code/firmware` |
| `Could not open /dev/ttyACM0` | no serial port permission | `newgrp dialout` (see Setup) |
| upload hangs | board not in download mode | hold BOOT, press RESET, release BOOT, upload again |
| `network not found` / RSSI below −85 dBm | antenna missing | attach the antenna |
| `connection rejected (wrong password?)` | wrong WiFi password | show the saved password: `nmcli -s -g 802-11-wireless-security.psk connection show <ssid>` |
| `HTTP -1` | vision service unreachable | is it running? is the IP in `config.h` current? 1–2 failures right after boot are normal |
| `Camera init failed` | camera module not seated | unplug USB, press the camera module firmly into place |
| network needs a login page | ESP32 cannot handle captive portals (e.g. eduroam) | use another network or a 2.4 GHz phone hotspot |
