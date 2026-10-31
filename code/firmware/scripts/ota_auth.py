# PlatformIO pre-script: reads OTA_PASSWORD from include/secrets.h and passes it to espota,
# so the password is defined in a single place.
import pathlib
import re

Import("env")  # noqa: F821 - provided by PlatformIO

secrets = pathlib.Path(env.subst("$PROJECT_DIR")) / "include" / "secrets.h"  # noqa: F821
match = re.search(r'#define\s+OTA_PASSWORD\s+"([^"]*)"', secrets.read_text()) if secrets.exists() else None
if match:
    env.Append(UPLOAD_FLAGS=["--auth=" + match.group(1)])  # noqa: F821
else:
    print("WARNING: OTA_PASSWORD missing in include/secrets.h - OTA upload will be rejected")
