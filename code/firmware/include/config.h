// Camera node configuration. All tunables live here.
#pragma once

// Per-person settings (camera name, target laptop) can be overridden in secrets.h, which is git-ignored,
// so nobody has to edit this file to test with their own laptop.

// The camera's ID comes from its MAC address (cam-a1b2c3) unless DEVICE_ID is set, so one firmware fits every board
// and two boards can't be taken for one camera. Zones are mapped to this ID.

// Vision service. Resolved via mDNS (<VISION_HOSTNAME>.local) first, then VISION_FALLBACK_IP.
#ifndef VISION_HOSTNAME
#define VISION_HOSTNAME "bikeslot"  // without ".local"; the vision service announces it (MDNS_HOSTNAME)
#endif
#ifndef VISION_FALLBACK_IP
#define VISION_FALLBACK_IP "192.168.22.2"  // only used if mDNS fails; set your laptop's IP in secrets.h
#endif
#define VISION_PORT 8001
#define VISION_PATH "/api/v1/frames"

// Image
#define FRAME_SIZE FRAMESIZE_XGA  // 1024x768, close to the vision model input (IMGSZ=960); VGA would be upscaled
#define JPEG_QUALITY 10           // 0..63, lower = better quality, larger file
#define CAMERA_VFLIP 1            // depends on how the camera is mounted
#define CAMERA_HMIRROR 0

// Timing
#define CAPTURE_INTERVAL_MS 300  // vision answers before analysing, and only ever analyses a camera's latest frame
#define HTTP_TIMEOUT_MS 5000

// Self-recovery: the node must run unattended for days.
#define WIFI_CONNECT_TIMEOUT_MS 20000  // per connection attempt
#define WIFI_RESTART_AFTER_MS 60000    // restart after this long without WiFi
#define MAX_CONSECUTIVE_FAILURES 10    // restart after this many failed capture/upload cycles
#define WATCHDOG_TIMEOUT_S 30          // restart if the main loop hangs this long
