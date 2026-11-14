#!/usr/bin/env python3
"""Download and prepare NASA GSFC LOLA 80 m/pixel south-pole hillshade.

The downloader supports HTTP Range resume where the NASA server permits it,
retries transient network failures, and validates the completed GeoTIFF before
processing it. Run from the SELENE-360 project root:
    python scripts/prepare-nasa-map.py
Dependencies: rasterio, numpy, pillow
"""
from __future__ import annotations

import json
import random
import shutil
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ_HILL.TIF"
SOURCE_FILE = DATA_DIR / "LDEM_80S_80MPP_ADJ_HILL.TIF"
PART_FILE = DATA_DIR / "LDEM_80S_80MPP_ADJ_HILL.TIF.part"
OUTPUT_FILE = DATA_DIR / "lola-south-pole-hillshade.png"
METADATA_FILE = DATA_DIR / "lola-south-pole-metadata.json"
MAX_DIMENSION = 2400
CHUNK_SIZE = 1024 * 1024
MAX_RETRIES = 8
TIMEOUT_SECONDS = 75


def request_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"User-Agent": "SELENE-360 educational research project/1.0"}
    if extra:
        headers.update(extra)
    return headers


def get_total_from_content_range(value: str | None) -> int | None:
    # Expected form: bytes 123-456/789
    if not value or "/" not in value:
        return None
    tail = value.rsplit("/", 1)[1].strip()
    return int(tail) if tail.isdigit() else None


def download_source() -> None:
    # If the earlier non-resumable script left a partial destination behind,
    # preserve it as the resume file instead of overwriting it.
    if SOURCE_FILE.exists() and not PART_FILE.exists():
        size = SOURCE_FILE.stat().st_size
        if size > 0:
            SOURCE_FILE.rename(PART_FILE)
            print(f"Preserved previous partial download ({size / 1_000_000:.1f} MB).")

    if SOURCE_FILE.exists():
        try:
            with rasterio.open(SOURCE_FILE) as ds:
                if ds.width > 0 and ds.height > 0:
                    print(f"Verified existing GeoTIFF: {SOURCE_FILE}")
                    return
        except Exception:
            print("Existing GeoTIFF is incomplete or invalid; will download again.")
            SOURCE_FILE.unlink(missing_ok=True)

    downloaded = PART_FILE.stat().st_size if PART_FILE.exists() else 0
    print("Downloading NASA LOLA hillshade (listed by NASA as 85 MB).")
    if downloaded:
        print(f"Resuming from {downloaded / 1_000_000:.1f} MB already downloaded.")

    total_size: int | None = None
    retries = 0
    while True:
        headers = request_headers({"Range": f"bytes={downloaded}-"} if downloaded else None)
        request = urllib.request.Request(SOURCE_URL, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", response.getcode())
                content_range = response.headers.get("Content-Range")

                if downloaded and status == 206:
                    range_start = 0
                    if content_range and content_range.startswith("bytes "):
                        range_start = int(content_range[6:].split("-", 1)[0])
                    if range_start != downloaded:
                        raise RuntimeError(
                            f"Server resumed at byte {range_start}, expected {downloaded}."
                        )
                    total_size = get_total_from_content_range(content_range)
                    file_mode = "ab"
                elif downloaded and status == 200:
                    # Server ignored Range. Restart cleanly to avoid corrupt concatenation.
                    print("Server does not honor resume requests; restarting download cleanly.")
                    downloaded = 0
                    PART_FILE.unlink(missing_ok=True)
                    total_size = int(response.headers.get("Content-Length", "0")) or None
                    file_mode = "wb"
                else:
                    total_size = int(response.headers.get("Content-Length", "0")) or None
                    file_mode = "wb"

                with PART_FILE.open(file_mode) as out:
                    while True:
                        chunk = response.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        out.write(chunk)
                        downloaded += len(chunk)
                        if total_size:
                            percent = min(100, downloaded * 100 / total_size)
                            print(
                                f"\rDownloaded {downloaded / 1_000_000:.1f} MB"
                                f" / {total_size / 1_000_000:.1f} MB ({percent:.1f}%)",
                                end="",
                                flush=True,
                            )
                        else:
                            print(f"\rDownloaded {downloaded / 1_000_000:.1f} MB", end="", flush=True)

            print("\nDownload stream finished; validating GeoTIFF...")
            if total_size is not None and downloaded != total_size:
                raise IOError(f"Download size mismatch: got {downloaded}, expected {total_size} bytes.")
            with rasterio.open(PART_FILE) as ds:
                if ds.width <= 0 or ds.height <= 0:
                    raise RuntimeError("Downloaded raster has invalid dimensions.")
                print(f"GeoTIFF validation passed: {ds.width} × {ds.height} pixels.")
            PART_FILE.replace(SOURCE_FILE)
            print(f"Saved verified NASA source: {SOURCE_FILE}")
            return

        except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError, OSError) as exc:
            # A read timeout can happen after some bytes have been written.
            downloaded = PART_FILE.stat().st_size if PART_FILE.exists() else 0
            retries += 1
            if retries > MAX_RETRIES:
                raise RuntimeError(
                    f"Download stopped after {MAX_RETRIES} retries. Partial data is kept at {PART_FILE}. "
                    "Run the same command later to resume."
                ) from exc
            delay = min(60, 2 ** retries) + random.random()
            print(
                f"\nNetwork interruption ({exc}). Keeping {downloaded / 1_000_000:.1f} MB. "
                f"Retry {retries}/{MAX_RETRIES} in {delay:.1f}s..."
            )
            time.sleep(delay)
        except Exception:
            # Preserve partial data for inspection/retry, but don't silently
            # loop on unexpected server/protocol or raster errors.
            raise


def main() -> None:
    download_source()
    with rasterio.open(SOURCE_FILE) as src:
        scale = min(1.0, MAX_DIMENSION / max(src.width, src.height))
        out_width = max(1, round(src.width * scale))
        out_height = max(1, round(src.height * scale))
        band = src.read(
            1,
            out_shape=(out_height, out_width),
            resampling=Resampling.bilinear,
            masked=True,
        )
        values = np.asarray(band.filled(0), dtype=np.float32)
        valid = ~np.ma.getmaskarray(band)
        if src.nodata is not None:
            valid &= values != src.nodata
        finite = values[valid & np.isfinite(values)]
        if finite.size == 0:
            raise RuntimeError("The downloaded raster contains no valid pixels.")

        if np.nanmin(finite) >= 0 and np.nanmax(finite) <= 255:
            gray = np.clip(values, 0, 255).astype(np.uint8)
        else:
            low, high = np.nanpercentile(finite, [1, 99])
            if high <= low:
                high = low + 1
            gray = np.clip((values - low) * 255 / (high - low), 0, 255).astype(np.uint8)

        rgba = np.dstack((gray, gray, gray, valid.astype(np.uint8) * 255))
        Image.fromarray(rgba, mode="RGBA").save(OUTPUT_FILE, optimize=True)

        transform = src.transform * src.transform.scale(
            src.width / out_width,
            src.height / out_height,
        )
        left, top = transform.c, transform.f
        right = left + transform.a * out_width
        bottom = top + transform.e * out_height
        metadata = {
            "source": SOURCE_URL,
            "product": "LDEM_80S_80MPP_ADJ_HILL.TIF",
            "provider": "NASA Goddard Space Flight Center PGDA",
            "instrument": "Lunar Orbiter Laser Altimeter (LOLA)",
            "coverage": "80°S to 90°S",
            "source_pixel_scale_m": 80,
            "source_crs": str(src.crs) if src.crs else None,
            "reference_frame": "MOON_ME / JPL DE421 (per NASA product documentation)",
            "image_width": out_width,
            "image_height": out_height,
            "bounds_m": {"left": left, "bottom": bottom, "right": right, "top": top},
            "transform": list(transform)[:6],
            "note": "Hillshade is terrain visualization, not raw elevation values.",
        }
        METADATA_FILE.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\nNASA hillshade preparation complete.")
    print(f"PNG: {OUTPUT_FILE}")
    print(f"Metadata: {METADATA_FILE}")
    print(f"Original GeoTIFF: {SOURCE_FILE}")


if __name__ == "__main__":
    main()
