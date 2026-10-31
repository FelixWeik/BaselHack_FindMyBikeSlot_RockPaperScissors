"""Tells the camera nodes where this service is: it answers for <name>.local on the local network.

The same firmware then works whichever machine runs the service, and whatever IP that machine gets. The announcement
is a convenience: when it fails, the service keeps running and the cameras use the fallback IP they were built with.
"""

import logging
import socket
from collections.abc import Callable
from dataclasses import dataclass

log = logging.getLogger("uvicorn.error")

SERVICE_TYPE = "_bikeslot._tcp.local."


def lan_ip() -> str:
    """The address of the default route's interface, so neither Docker bridges nor a VPN. Sends nothing."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("192.0.2.1", 9))
        return probe.getsockname()[0]


@dataclass(frozen=True)
class Announcement:
    stop: Callable[[], None]


def announce(hostname: str, port: int) -> Announcement | None:
    if not hostname:
        return None
    try:
        from zeroconf import IPVersion, ServiceInfo, Zeroconf

        ip = lan_ip()
        info = ServiceInfo(
            SERVICE_TYPE,
            f"{hostname}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(ip)],
            port=port,
            server=f"{hostname}.local.",
        )
        zeroconf = Zeroconf(interfaces=[ip], ip_version=IPVersion.V4Only)
        try:
            zeroconf.register_service(info)
        except Exception:
            zeroconf.close()
            raise
    except Exception as err:
        # Most likely another machine already holds the name: the cameras would then go there.
        log.warning("Could not announce %s.local: %s: %s", hostname, type(err).__name__, err)
        return None
    log.warning("Announcing %s.local -> %s:%d for the camera nodes", hostname, ip, port)

    def stop() -> None:
        zeroconf.unregister_service(info)
        zeroconf.close()

    return Announcement(stop)
