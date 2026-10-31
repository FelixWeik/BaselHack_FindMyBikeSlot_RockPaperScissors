"""Zones, capacities, occupancy and fusion, driven through the API with a fake clock and fake bike boxes."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.occupancy import mean_fusion

TTL = 30
WHOLE_IMAGE = [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}]
LEFT = [{"x": 0, "y": 0}, {"x": 0.5, "y": 0}, {"x": 0.5, "y": 1}, {"x": 0, "y": 1}]
RIGHT = [{"x": 0.5, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0.5, "y": 1}]
DAY = [{"start": "06:00", "end": "20:00"}]


class Clock:
    now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def client(tmp_path, clock):
    return TestClient(create_app(tmp_path / "test.db", measurement_ttl_s=TTL, clock=clock))


def region(region_id="A", capacity=20):
    return {
        "id": region_id,
        "name": region_id,
        "slotCount": capacity,
        "boundary": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 2}],
    }


def camera(camera_id, views):
    return {"id": camera_id, "name": camera_id, "views": [{"regionId": z, "polygon": p} for z, p in views.items()]}


def parking(regions, cameras, parking_id="p1"):
    return {
        "version": 1,
        "id": parking_id,
        "name": parking_id,
        "totalSlots": sum(r["slotCount"] for r in regions),
        "geometry": {"regions": regions},
        "slotSize": {"widthMeters": 0.7, "lengthMeters": 2},
        "schedule": {
            "timezone": "Europe/Zurich",
            "weekly": dict.fromkeys(("mon", "tue", "wed", "thu", "fri", "sat", "sun"), DAY),
        },
        "cameras": cameras,
    }


def save(client, *args, **kwargs):
    body = parking(*args, **kwargs)
    response = client.put(f"/api/v1/parkings/{body['id']}", json=body)
    assert response.status_code == 200, response.text
    return body


def bikes(n, x=0.25):
    return [{"bbox": [x - 0.01, 0.4, x + 0.01, 0.6], "conf": 0.9} for _ in range(n)]


def see(client, camera_id, n, status="ok", x=0.25):
    observation = {"device_id": camera_id, "ts": "2026-10-31T10:00:00Z", "status": status, "bikes": bikes(n, x)}
    assert client.post("/api/v1/observations", json=observation).status_code == 201


def zone(client, zone_id="A", parking_id="p1"):
    answer = client.get(f"/api/v1/parkings/{parking_id}/occupancy").json()
    return next(z for z in answer["zones"] if z["zoneId"] == zone_id)


def one_camera(client, capacity=20):
    return save(client, [region(capacity=capacity)], [camera("cam-1", {"A": WHOLE_IMAGE})])


def two_cameras(client, capacity=20):
    return save(client, [region(capacity=capacity)], [camera("c1", {"A": WHOLE_IMAGE}), camera("c2", {"A": LEFT})])


# Zones and capacities


def test_second_camera_shares_the_zone_with_its_own_polygon(client):
    two_cameras(client)
    saved = client.get("/api/v1/parkings").json()[0]
    assert [r["id"] for r in saved["geometry"]["regions"]] == ["A"]
    polygons = [c["views"][0]["polygon"] for c in saved["cameras"]]
    assert polygons[0] != polygons[1]


def test_every_camera_uses_the_same_capacity(client):
    two_cameras(client)
    see(client, "c1", 15)
    see(client, "c2", 17)
    cameras = client.get("/api/v1/parkings/p1/cameras").json()["cameras"]
    assert [c["zones"][0]["capacity"] for c in cameras] == [20, 20]
    assert [c["zones"][0]["occupancy"] for c in cameras] == [0.75, 0.85]


def test_changing_the_capacity_reaches_every_camera_and_the_fusion_at_once(client):
    two_cameras(client)
    see(client, "c1", 15)
    see(client, "c2", 17)
    assert zone(client)["occupancy"] == pytest.approx(0.8)
    two_cameras(client, capacity=40)
    cameras = client.get("/api/v1/parkings/p1/cameras").json()["cameras"]
    assert [c["zones"][0]["occupancy"] for c in cameras] == [0.375, 0.425]
    assert zone(client)["occupancy"] == pytest.approx(0.4)
    assert zone(client)["capacity"] == 40


def test_capacity_is_stored_only_on_the_zone(client):
    two_cameras(client)
    for saved_camera in client.get("/api/v1/parkings").json()[0]["cameras"]:
        assert "capacity" not in str(saved_camera).lower()
        assert "slotCount" not in str(saved_camera)


@pytest.mark.parametrize("capacity", [0, -1])
def test_invalid_capacity_is_refused(client, capacity):
    body = parking([region(capacity=capacity)], [])
    assert client.put("/api/v1/parkings/p1", json=body).status_code == 422


def test_a_view_of_an_unknown_zone_is_refused(client):
    body = parking([region()], [camera("c1", {"nope": WHOLE_IMAGE})])
    assert client.put("/api/v1/parkings/p1", json=body).status_code == 422


def test_overlapping_polygons_of_one_camera_are_refused(client):
    body = parking([region("A"), region("B")], [camera("c1", {"A": WHOLE_IMAGE, "B": LEFT})])
    assert client.put("/api/v1/parkings/p1", json=body).status_code == 422


def test_a_polygon_crossing_itself_is_refused(client):
    bow_tie = [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 1, "y": 0}, {"x": 0, "y": 1}]
    body = parking([region()], [camera("c1", {"A": bow_tie})])
    assert client.put("/api/v1/parkings/p1", json=body).status_code == 422


def test_polygons_of_different_cameras_may_overlap(client):
    two_cameras(client)


def test_neighbouring_polygons_of_one_camera_are_accepted(client):
    save(client, [region("A"), region("B")], [camera("c1", {"A": LEFT, "B": RIGHT})])


def test_a_camera_belongs_to_one_parking(client):
    save(client, [region()], [camera("c1", {"A": WHOLE_IMAGE})])
    body = parking([region()], [camera("c1", {"A": WHOLE_IMAGE})], parking_id="p2")
    assert client.put("/api/v1/parkings/p2", json=body).status_code == 409


# Occupancy


def test_an_analysed_empty_zone_is_zero_not_unknown(client):
    one_camera(client)
    see(client, "cam-1", 0)
    answer = zone(client)
    assert (answer["occupancy"], answer["detected"], answer["status"]) == (0, 0, "valid")


def test_partly_occupied_zone(client):
    one_camera(client)
    see(client, "cam-1", 5)
    assert zone(client)["occupancy"] == 0.25


def test_full_zone(client):
    one_camera(client)
    see(client, "cam-1", 20)
    assert (zone(client)["occupancy"], zone(client)["overflow"]) == (1, False)


def test_more_bikes_than_capacity_is_bounded_and_flagged(client):
    one_camera(client)
    see(client, "cam-1", 25)
    answer = zone(client)
    assert (answer["occupancy"], answer["detected"], answer["overflow"]) == (1, 25, True)
    assert client.get("/api/v1/parkings/p1/cameras").json()["cameras"][0]["zones"][0]["rawOccupancy"] == 1.25


def test_bikes_are_attributed_to_their_own_zone(client):
    save(client, [region("A"), region("B")], [camera("c1", {"A": LEFT, "B": RIGHT})])
    observation = {
        "device_id": "c1",
        "ts": "2026-10-31T10:00:00Z",
        "status": "ok",
        "bikes": bikes(2, x=0.25) + bikes(4, x=0.75),
    }
    client.post("/api/v1/observations", json=observation)
    assert zone(client, "A")["detected"] == 2
    assert zone(client, "B")["detected"] == 4


def test_the_median_of_recent_frames_ignores_a_glitch(client):
    one_camera(client)
    for n in (10, 10, 3, 10, 10):
        see(client, "cam-1", n)
    assert zone(client)["detected"] == 10


# Fusion


def test_fusion_of_one_camera(client):
    one_camera(client)
    see(client, "cam-1", 14)
    assert (zone(client)["occupancy"], zone(client)["cameraCount"]) == (0.7, 1)


def test_fusion_of_several_cameras_with_different_counts(client):
    save(
        client,
        [region()],
        [camera("a", {"A": WHOLE_IMAGE}), camera("b", {"A": WHOLE_IMAGE}), camera("c", {"A": WHOLE_IMAGE})],
    )
    see(client, "a", 14)
    see(client, "b", 16)
    see(client, "c", 18)
    answer = zone(client)
    assert (answer["occupancy"], answer["detected"], answer["cameraCount"]) == (pytest.approx(0.8), 16, 3)


def test_fusion_averages_before_bounding(client):
    two_cameras(client)
    see(client, "c1", 25)
    see(client, "c2", 15)
    assert (zone(client)["occupancy"], zone(client)["overflow"]) == (1, False)


def test_mean_fusion_is_replaceable():
    assert mean_fusion([0.7, 0.8, 0.9]) == pytest.approx(0.8)


def test_only_cameras_configured_for_the_zone_count(client):
    save(client, [region("A"), region("B")], [camera("c1", {"A": WHOLE_IMAGE}), camera("c2", {"B": WHOLE_IMAGE})])
    see(client, "c1", 10)
    see(client, "c2", 2)
    assert (zone(client, "A")["detected"], zone(client, "A")["cameraCount"]) == (10, 1)
    assert (zone(client, "B")["detected"], zone(client, "B")["cameraCount"]) == (2, 1)


def test_a_disconnected_camera_leaves_the_mean(client, clock):
    two_cameras(client)
    see(client, "c1", 10)
    clock.now += TTL - 1
    see(client, "c2", 16)
    clock.now += 2  # c1's measurement has now expired, c2's hasn't
    answer = zone(client)
    assert (answer["occupancy"], answer["cameraCount"]) == (0.8, 1)


def test_an_expired_measurement_makes_the_zone_unknown_not_empty(client, clock):
    one_camera(client)
    see(client, "cam-1", 10)
    assert zone(client)["status"] == "valid"
    clock.now += TTL + 1
    answer = zone(client)
    assert (answer["status"], answer["occupancy"], answer["detected"]) == ("unknown", None, None)


def test_no_measurement_at_all_is_unknown(client):
    one_camera(client)
    assert zone(client)["status"] == "unknown"
    assert client.get("/api/v1/parkings/p1/occupancy").json()["updatedAt"] is None


def test_a_zone_without_camera_is_unknown(client):
    save(client, [region()], [])
    assert zone(client)["status"] == "unknown"


@pytest.mark.parametrize("status", ["failed", "dark", "not_ready"])
def test_a_failed_analysis_is_unknown_not_empty(client, status):
    one_camera(client)
    see(client, "cam-1", 10)
    see(client, "cam-1", 0, status=status)
    assert zone(client)["status"] == "unknown"
    assert client.get("/api/v1/devices").json()[0]["online"] is True


def test_a_failed_camera_does_not_pull_the_mean_down(client):
    two_cameras(client)
    see(client, "c1", 10)
    see(client, "c2", 0, status="failed")
    assert (zone(client)["occupancy"], zone(client)["cameraCount"]) == (0.5, 1)


# Devices


def test_an_uncalibrated_camera_is_discovered(client):
    assert client.get("/api/v1/devices").json() == []
    client.post(
        "/api/v1/observations",
        json={"device_id": "new", "ts": "2026-10-31T10:00:00Z", "status": "ok", "bikes": [], "rssi": -60},
    )
    device = client.get("/api/v1/devices").json()[0]
    assert (device["id"], device["kind"], device["online"], device["rssi"]) == ("new", "camera", True, -60)


def test_a_silent_camera_goes_offline(client, clock):
    see(client, "c1", 0)
    clock.now += TTL + 1
    assert client.get("/api/v1/devices").json()[0]["online"] is False


def test_observations_cannot_carry_an_image(client):
    observation = {"device_id": "c1", "ts": "2026-10-31T10:00:00Z", "status": "ok", "bikes": bikes(1)}
    assert client.post("/api/v1/observations", json=observation).status_code == 201
    assert "image" not in str(client.get("/api/v1/devices").json())


def test_bad_boxes_are_refused(client):
    observation = {"device_id": "c1", "ts": "2026-10-31T10:00:00Z", "status": "ok"}
    bad = [{"bbox": [0.5, 0.5, 0.4, 0.6], "conf": 0.9}]
    assert client.post("/api/v1/observations", json=observation | {"bikes": bad}).status_code == 422
    bad = [{"bbox": [100, 100, 200, 200], "conf": 0.9}]
    assert client.post("/api/v1/observations", json=observation | {"bikes": bad}).status_code == 422


# Calibration capture


def capture_client(tmp_path, capture):
    return TestClient(create_app(tmp_path / "test.db", capture=capture))


def test_capture_returns_the_image_without_caching(tmp_path):
    jpeg = b"\xff\xd8masked\xff\xd9"
    client = capture_client(
        tmp_path, lambda _id: httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})
    )
    answer = client.post("/api/v1/cameras/c1/calibration-capture")
    assert answer.status_code == 200
    assert answer.content == jpeg
    assert answer.headers["cache-control"] == "no-store"


def test_a_failed_anonymization_transmits_no_image(tmp_path):
    client = capture_client(tmp_path, lambda _id: httpx.Response(503, json={"detail": "Could not anonymize"}))
    answer = client.post("/api/v1/cameras/c1/calibration-capture")
    assert answer.status_code == 503
    assert answer.json() == {"detail": "Could not anonymize"}


def test_only_a_jpeg_answer_is_passed_on(tmp_path):
    client = capture_client(
        tmp_path, lambda _id: httpx.Response(200, text="<html>", headers={"content-type": "text/html"})
    )
    assert client.post("/api/v1/cameras/c1/calibration-capture").status_code == 502


def test_capture_with_the_vision_service_down(tmp_path):
    def down(_id):
        raise httpx.ConnectError("refused")

    assert capture_client(tmp_path, down).post("/api/v1/cameras/c1/calibration-capture").status_code == 503


def test_no_route_serves_an_image_outside_the_capture(client):
    paths = {route.path for route in client.app.routes}
    assert not any(word in path for path in paths for word in ("frame", "snapshot", "jpg", "photo"))
