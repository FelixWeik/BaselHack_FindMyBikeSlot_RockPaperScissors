# PlatformIO-Hilfsskript: liest OTA_PASSWORD aus include/secrets.h und gibt es an den
# WLAN-Upload weiter. So muss das Passwort nur an einer Stelle stehen.
import pathlib
import re

Import("env")  # noqa: F821 – wird von PlatformIO bereitgestellt

secrets = pathlib.Path(env.subst("$PROJECT_DIR")) / "include" / "secrets.h"  # noqa: F821
match = re.search(r'#define\s+OTA_PASSWORD\s+"([^"]*)"', secrets.read_text()) if secrets.exists() else None
if match:
    env.Append(UPLOAD_FLAGS=["--auth=" + match.group(1)])  # noqa: F821
else:
    print("WARNUNG: OTA_PASSWORD fehlt in include/secrets.h – WLAN-Upload wird abgelehnt")
