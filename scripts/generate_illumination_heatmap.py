import json
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

SOURCE = "public/data/LDEM_80S_80MPP_ADJ.TIF"
VECTOR_FILE = "public/data/solar-vector.json"
OUTPUT = "public/data/lola-south-pole-illumination.png"

WORK_SIZE = 1200
OUTPUT_SIZE = 2400

LUNAR_RADIUS_M = 1_737_400.0
MAX_SHADOW_DISTANCE_M = 20_000.0

# --------------------------------------------------
# 1. LOAD THE MOON-FIXED SOLAR VECTOR
# --------------------------------------------------

with open(VECTOR_FILE, "r") as file:
    solar_data = json.load(file)

sun = solar_data["sunMoonFixed"]
sx, sy, sz = sun["x"], sun["y"], sun["z"]

print("Solar timestamp:", solar_data["timestamp"])
print("Moon-fixed Sun vector:", sun)

# --------------------------------------------------
# 2. LOAD LOLA TERRAIN
# --------------------------------------------------

with rasterio.open(SOURCE) as src:
    elevation = src.read(
        1,
        out_shape=(WORK_SIZE, WORK_SIZE),
        resampling=Resampling.bilinear,
        masked=True,
    ).filled(np.nan).astype(np.float32)

    transform = src.transform

    spacing_x = abs(transform.a) * src.width / WORK_SIZE
    spacing_y = abs(transform.e) * src.height / WORK_SIZE

    left = transform.c
    top = transform.f

print("Working grid:", elevation.shape)
print("Working pixel spacing:", spacing_x, "m")

# --------------------------------------------------
# 3. MAP PIXELS TO LUNAR LATITUDE/LONGITUDE
# --------------------------------------------------

rows, cols = np.indices(elevation.shape, dtype=np.float32)

x = left + (cols + 0.5) * spacing_x
y = top - (rows + 0.5) * spacing_y

rho = np.hypot(x, y)

longitude = np.arctan2(x, y)

latitude = (
    -np.pi / 2
    + 2 * np.arctan2(rho, 2 * LUNAR_RADIUS_M)
)

cos_lat = np.cos(latitude)
sin_lat = np.sin(latitude)
cos_lon = np.cos(longitude)
sin_lon = np.sin(longitude)

# Local spherical reference frame, matching the
# lunarIllumination.ts coordinate convention.

up_x = cos_lat * cos_lon
up_y = cos_lat * sin_lon
up_z = sin_lat

east_x = -sin_lon
east_y = cos_lon

north_x = -sin_lat * cos_lon
north_y = -sin_lat * sin_lon
north_z = cos_lat

up_component = (
    sx * up_x
    + sy * up_y
    + sz * up_z
)

east_component = sx * east_x + sy * east_y

north_component = (
    sx * north_x
    + sy * north_y
    + sz * north_z
)

solar_elevation = np.arcsin(
    np.clip(up_component, -1.0, 1.0)
)

solar_azimuth = np.arctan2(
    east_component,
    north_component,
)

# --------------------------------------------------
# 4. CONVERT LOCAL SUN DIRECTION TO MAP DIRECTION
# --------------------------------------------------

# In this south-polar stereographic projection:
# local east points around the pole;
# local north points radially toward the pole.

map_dx = (
    east_component * cos_lon
    + north_component * sin_lon
)

map_dy = (
    -east_component * sin_lon
    + north_component * cos_lon
)

horizontal_length = np.hypot(map_dx, map_dy)

safe_length = np.maximum(horizontal_length, 1e-12)

map_dx /= safe_length
map_dy /= safe_length

# Raster rows increase downward.
column_direction = map_dx
row_direction = -map_dy

# --------------------------------------------------
# 5. INITIAL GEOMETRIC SUNLIGHT TEST
# --------------------------------------------------

valid = np.isfinite(elevation)

sunlit = (
    (solar_elevation > 0)
    & valid
)

# --------------------------------------------------
# 6. TRACE TERRAIN SHADOWS
# --------------------------------------------------

step_m = max(spacing_x, spacing_y)

steps = int(MAX_SHADOW_DISTANCE_M / step_m)

tan_elevation = np.tan(
    np.maximum(solar_elevation, 0)
)

blocked = np.zeros(
    elevation.shape,
    dtype=bool,
)

base_rows = np.arange(WORK_SIZE)[:, None]
base_cols = np.arange(WORK_SIZE)[None, :]

for step in range(1, steps + 1):
    distance = step * step_m

    sample_rows = np.rint(
        base_rows + row_direction * step
    ).astype(np.int32)

    sample_cols = np.rint(
        base_cols + column_direction * step
    ).astype(np.int32)

    inside = (
        (sample_rows >= 0)
        & (sample_rows < WORK_SIZE)
        & (sample_cols >= 0)
        & (sample_cols < WORK_SIZE)
    )

    safe_rows = np.clip(
        sample_rows, 0, WORK_SIZE - 1
    )

    safe_cols = np.clip(
        sample_cols, 0, WORK_SIZE - 1
    )

    target_elevation = elevation[
        safe_rows, safe_cols
    ]

    # Approximate curvature drop over the lunar surface.
    ray_height = (
        elevation
        + distance * tan_elevation
        - distance * distance / (2 * LUNAR_RADIUS_M)
    )

    obstruction = (
        inside
        & np.isfinite(target_elevation)
        & (target_elevation > ray_height)
    )

    blocked |= obstruction & sunlit

    if step % 10 == 0 or step == steps:
        print(
            f"Shadow tracing: {step}/{steps} "
            f"({100 * step / steps:.0f}%)"
        )

sunlit &= ~blocked

# --------------------------------------------------
# 7. CREATE TRANSPARENT COLOUR OVERLAY
# --------------------------------------------------

rgba = np.zeros(
    (WORK_SIZE, WORK_SIZE, 4),
    dtype=np.uint8,
)

# Dark navy = geometric lunar night.
night = valid & (solar_elevation <= 0)
rgba[night] = [20, 35, 60, 115]

# Warm amber = estimated sunlight.
rgba[sunlit] = [255, 174, 76, 155]

# Cool navy-blue = terrain shadow.
shadow = valid & (solar_elevation > 0) & blocked
rgba[shadow] = [55, 91, 145, 175]

# Geometric night remains transparent.
# Missing DEM data remains transparent.

image = Image.fromarray(rgba, mode="RGBA")

image = image.resize(
    (OUTPUT_SIZE, OUTPUT_SIZE),
    Image.Resampling.BILINEAR,
)

image.save(OUTPUT, optimize=True)

# --------------------------------------------------
# 8. REPORT
# --------------------------------------------------

valid_count = int(np.count_nonzero(valid))
sunlit_count = int(np.count_nonzero(sunlit))
shadow_count = int(np.count_nonzero(shadow))

print()
print("========================================")
print("SOLARIS ILLUMINATION HEATMAP GENERATED")
print("========================================")
print("Output:", OUTPUT)
print("Timestamp:", solar_data["timestamp"])
print("Output dimensions:", OUTPUT_SIZE, "x", OUTPUT_SIZE)
print("Working dimensions:", WORK_SIZE, "x", WORK_SIZE)
print("Shadow range:", MAX_SHADOW_DISTANCE_M, "m")
print("Valid terrain pixels:", valid_count)
print("Estimated sunlit pixels:", sunlit_count)
print("Estimated terrain-shadow pixels:", shadow_count)

if valid_count:
    print(
        "Sunlit percentage:",
        round(100 * sunlit_count / valid_count, 2),
        "%"
    )

print("Amber: estimated direct sunlight")
print("Blue: estimated terrain shadow")
print("Transparent: night or unavailable terrain")
print("Method: approximate DEM ray tracing")
print("Safety classification: NOT PERFORMED")
print("========================================")
