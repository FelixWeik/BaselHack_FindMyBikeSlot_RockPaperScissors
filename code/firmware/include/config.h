// Camera node configuration. All tunables live here.
#pragma once

// Per-person settings (camera name, target laptop) can be overridden in secrets.h, which is git-ignored,
// so nobody has to edit this file to test with their own laptop.

// Unique per camera; the backend maps parking zones by this ID.
#ifndef DEVICE_ID
#define DEVICE_ID "cam-memox-nord"
#endif

// Vision service. Resolved via mDNS (<VISION_HOSTNAME>.local) first, then VISION_FALLBACK_IP.
#ifndef VISION_HOSTNAME
#define VISION_HOSTNAME "tempestD"  // without ".local"
#endif
#ifndef VISION_FALLBACK_IP
#define VISION_FALLBACK_IP "192.168.22.2"  // only used if mDNS fails; laptop IP on memox.world
#endif
#define VISION_PORT 8001
#define VISION_PATH "/api/v1/frames"

// Image
#define FRAME_SIZE FRAMESIZE_XGA  // 1024x768, close to the vision model input (IMGSZ=960); VGA would be upscaled
#define JPEG_QUALITY 10           // 0..63, lower = better quality, larger file
#define CAMERA_VFLIP 1            // depends on how the camera is mounted
#define CAMERA_HMIRROR 0

// Timing
#define CAPTURE_INTERVAL_MS 300  // upper bound only: each upload waits for the vision reply, so YOLO sets the pace
#define HTTP_TIMEOUT_MS 5000

// Self-recovery: the node must run unattended for days.
#define WIFI_CONNECT_TIMEOUT_MS 20000  // per connection attempt
#define WIFI_RESTART_AFTER_MS 60000    // restart after this long without WiFi
#define MAX_CONSECUTIVE_FAILURES 10    // restart after this many failed capture/upload cycles
#define WATCHDOG_TIMEOUT_S 30          // restart if the main loop hangs this long
