# Camera node firmware

Each camera node captures about three JPEGs a second and sends them over WiFi to the vision service. USB only powers
and flashes the board: plugging it into the server doesn't connect it to anything.
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

# 2. Linux only: serial port access (the group is `uucp` on Arch, `dialout` on Debian and Ubuntu)
sudo usermod -aG uucp $USER         # log out and back in, or run: newgrp uucp

# 3. Credentials (git-ignored)
cp include/secrets.h.example include/secrets.h
#    then set the WiFi network, its password, VISION_FALLBACK_IP and an OTA password
```

## Several cameras

The same firmware fits every board:

- **ID:** each camera names itself after its MAC address (`cam-a1b2c3`), printed at boot. To force a name, set
  `DEVICE_ID` in `secrets.h`, one per camera. Zones are mapped to this ID, so changing it means calibrating again.
- **Server:** each camera looks for `bikeslot.local`, which the vision service announces when `MDNS_HOSTNAME=bikeslot`
  is set (`scripts/start.sh` does). If nothing answers, it uses `VISION_FALLBACK_IP`, set in `secrets.h` to the IP of the
  machine running the vision service (`scripts/start.sh` prints it). It looks again at each restart. To send to one
  laptop while another one announces the name, set `VISION_HOSTNAME` in `secrets.h`.
- **Network:** the camera and the server must be on the same network, and the board only has 2.4 GHz WiFi.

A camera built from an older version keeps sending where it was built to send, until it's flashed once.

## Build, flash, monitor

Run all `pio` commands from `code/firmware/`.

```bash
pio run -t upload                   # flash over USB
pio device monitor                  # serial log (Ctrl+C to quit)

# Flash over WiFi, with the OTA password this camera was built with
pio run -e xiao_s3_ota -t upload --upload-port <camera-ip>
```

Expected log:

```
=== Camera 'cam-a1b2c3' booting (reset reason: power on) ===
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
| short flash per frame | frame delivered |
| steady on | connecting to WiFi, or the last attempt failed (vision service down? wrong IP?) |

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
X-Device-Id: cam-a1b2c3          camera name, from the MAC address
X-RSSI: -55                      WiFi signal in dBm
X-Uptime-S: 1234                 seconds since boot
Body: JPEG, 1024x768
```

`200` means delivered; any other response counts as a failure. See [`documentation/api.md`](../../documentation/api.md).

## Configuration (`include/config.h`)

| Setting | Default | Purpose |
|---|---|---|
| `DEVICE_ID` | unset: `cam-` + end of the MAC address | camera name, unique per camera; override in `secrets.h` |
| `VISION_HOSTNAME` | `bikeslot` | target host, via mDNS (`.local`); override in `secrets.h` |
| `VISION_FALLBACK_IP` | `192.168.22.2` | target host when mDNS doesn't answer; override in `secrets.h` |
| `FRAME_SIZE` | `FRAMESIZE_XGA` (1024×768) | resolution |
| `JPEG_QUALITY` | `10` | 0..63, lower = sharper but larger |
| `CAMERA_VFLIP` / `CAMERA_HMIRROR` | `1` / `0` | flip/mirror depending on mounting |
| `CAPTURE_INTERVAL_MS` | `300` | time between frames |

## Troubleshooting

| Message / symptom | Cause | Fix |
|---|---|---|
| `Not a PlatformIO project` | wrong directory | `cd code/firmware` |
| `Could not open /dev/ttyACM0` | no serial port permission | see Setup, step 2 |
| no `/dev/ttyACM0`, kernel log says `error -71` | bad USB contact or a charge-only cable | another cable or port |
| upload hangs | board not in download mode | hold BOOT, press RESET, release BOOT, upload again |
| `network not found` / RSSI below −85 dBm | antenna missing | attach the antenna |
| `connection rejected (wrong password?)` | wrong WiFi password | show the saved password: `nmcli -s -g 802-11-wireless-security.psk connection show <ssid>` |
| `HTTP -1` | vision service unreachable | is it running? is `VISION_FALLBACK_IP` current? 1–2 failures right after boot are normal |
| `Camera init failed` | camera module not seated | unplug USB, press the camera module firmly into place |
| network needs a login page | ESP32 cannot handle captive portals (e.g. eduroam) | use another network or a 2.4 GHz phone hotspot |
