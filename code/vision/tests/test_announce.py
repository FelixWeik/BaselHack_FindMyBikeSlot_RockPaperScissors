import logging

from app import announce as announce_module
from app.announce import announce


def test_nothing_is_announced_unless_asked():
    assert announce("", 8001) is None


def test_a_failed_announcement_does_not_stop_the_service(monkeypatch, caplog):
    def no_network():
        raise OSError("no route")

    monkeypatch.setattr(announce_module, "lan_ip", no_network)
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        assert announce("bikeslot", 8001) is None
    assert "bikeslot.local" in caplog.text
