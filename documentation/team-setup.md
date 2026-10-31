# Testing on your own laptop

Everything runs on one laptop: backend, vision service and web app. A camera node, or the fake camera, sends its
frames to that laptop.

```
ESP32 camera ──WiFi──▶ your laptop :8001 (vision) ──▶ :8000 (backend) ──▶ :3000 (web app)
fake camera  ─────────▶
```

## 1. Start the system

Requirements: [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Bun](https://bun.sh/) (npm works too).
Linux or macOS. On Windows, see [Windows](#windows).

```bash
git clone git@github.com:FelixWeik/BaselHack_FindMyBikeSlot_RockPaperScissors.git
cd BaselHack_FindMyBikeSlot_RockPaperScissors
scripts/start.sh
```

The first run installs everything, PyTorch included, and takes a few minutes. Then the script prints the URLs and
the lines your camera needs. `Ctrl+C` stops everything.

| URL | What |
|---|---|
| http://localhost:3000 | web app (phones on the same WiFi: the address the script prints) |
| http://localhost:3000/admin | create a zone and calibrate cameras |
| http://localhost:8001/demo | what each camera sees, bikes boxed, faces masked |
| http://localhost:8000/docs | backend API |

## 2a. No camera: the fake camera

In a second terminal:

```bash
cd code/vision
uv run python tools/fake_camera.py                             # a rack photo from assets/, as camera "cam-fake"
uv run python tools/fake_camera.py ~/my-photos/ --id cam-alice  # your own photos, one after the other
```

Your own phone photos of a bike rack work well. They're scaled to the camera's resolution.

## 2b. With an ESP32 camera node

Hardware: Seeed XIAO ESP32S3 Sense with its camera and **the external WiFi antenna plugged in** (it can't
connect without it), plus a USB-C data cable.

```bash
uv tool install platformio
cd code/firmware
cp include/secrets.h.example include/secrets.h
```

In `include/secrets.h` (git-ignored, so it's only yours):

- **WiFi:** a 2.4 GHz network your laptop is on too. If the venue WiFi doesn't let devices see each other, use
  your phone's hotspot for both the laptop and the camera.
- **The three lines `scripts/start.sh` printed:** `DEVICE_ID`, `VISION_HOSTNAME`, `VISION_FALLBACK_IP`. Each
  camera needs its own `DEVICE_ID`.

Then plug the camera in and flash it:

```bash
pio run -t upload        # Linux, first time: sudo usermod -aG dialout $USER, then log in again
pio device monitor       # serial log, Ctrl+C to quit
```

Expected log: `WiFi connected`, then a `Frame: ... -> HTTP 200` line per frame. The camera's LED flashes briefly
for each frame delivered.

## 3. Calibrate and test

1. http://localhost:8001/demo shows the camera's picture. Check that it points at the bikes.
2. http://localhost:3000/admin: **Create a zone**, then **Calibrate** your camera and draw the sub-zones on its
   picture.
3. http://localhost:3000/map shows the occupancy live. Move a bike in front of the camera, or switch photos with the
   fake camera, and watch it change.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `port 8001 is already in use` | an old `start.sh` or `test_receiver.py` still runs: stop it |
| camera log: `.local not found, using fallback IP`, then failures | mDNS doesn't work on this network: check that `VISION_FALLBACK_IP` is your laptop's current IP (the script prints it) |
| camera: `HTTP -1` / connection refused | the laptop firewall blocks port 8001: allow it (macOS asks on the first start; on Linux e.g. `sudo ufw allow 8001`) |
| camera never connects to WiFi | antenna not plugged in, or a 5 GHz-only network |
| camera page stays dark at night | expected: a frame too dark to read counts as "unknown", never as "empty" |
| `pio run -t upload` can't find the port | data cable, not a charging-only one; on Linux the `dialout` group (see above) |

## Windows

Run the script in WSL. A camera node can't reach a service inside WSL's default NAT network, so for a real camera
either turn on WSL's mirrored networking (`networkingMode=mirrored` in `.wslconfig`) or start the three services
natively as in the [readme's manual steps](../readme.md#quick-start). The fake camera works in every setup.
