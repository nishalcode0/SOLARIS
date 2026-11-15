
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

SOURCE = "public/data/LDEM_80S_80MPP_ADJ.TIF"
OUTPUT = "public/data/lola-south-pole-slope.png"

OUTPUT_SIZE = 2400
OPACITY = 180

# --------------------------------------------------
# 1. LOAD NASA LOLA ELEVATION DATA
# --------------------------------------------------

with rasterio.open(SOURCE) as src:
    print("Source dimensions:", src.width, "x", src.height)
    print("Source CRS:", src.crs)

    elevation = src.read(
        1,
        out_shape=(OUTPUT_SIZE, OUTPUT_SIZE),
        resampling=Resampling.bilinear,
        masked=True,
    ).filled(np.nan).astype(np.float32)

    # Derive visualization pixel spacing from the source raster.
    pixel_spacing = (
        abs(src.transform.a) * src.width / OUTPUT_SIZE
    )

print("Visualization spacing:", round(pixel_spacing, 2), "m")

# --------------------------------------------------
# 2. HORN 3 x 3 SLOPE CALCULATION
# --------------------------------------------------

dzdx = (
    elevation[:-2, 2:]
    + 2 * elevation[1:-1, 2:]
    + elevation[2:, 2:]
    - elevation[:-2, :-2]
    - 2 * elevation[1:-1, :-2]
    - elevation[2:, :-2]
) / (8 * pixel_spacing)

dzdy = (
    elevation[2:, :-2]
    + 2 * elevation[2:, 1:-1]
    + elevation[2:, 2:]
    - elevation[:-2, :-2]
    - 2 * elevation[:-2, 1:-1]
    - elevation[:-2, 2:]
) / (8 * pixel_spacing)

slope = np.degrees(
    np.arctan(np.hypot(dzdx, dzdy))
)

valid = np.isfinite(slope)

# --------------------------------------------------
# 3. CONTINUOUS COLOUR GRADIENT
# --------------------------------------------------

# Slope angle reference points and RGB colours.
# These are visualization categories, NOT safety limits.

stops = np.array([
    0,
    5,
    10,
    15,
    20,
    25,
    30,
    35,
    45,
], dtype=np.float32)

palette = np.array([
    [0,   201, 167],  # Vibrant turquoise
    [75,  220, 125],  # Green
    [174, 235, 75],   # Lime
    [255, 221, 55],   # Yellow
    [255, 157, 45],   # Orange
    [245, 83,  60],   # Coral red
    [220, 46,  130],  # Magenta
    [155, 61,  224],  # Violet
    [100, 35,  180],  # Deep violet
], dtype=np.float32)

# --------------------------------------------------
# 4. INTERPOLATE EVERY VALID PIXEL
# --------------------------------------------------

rgba = np.zeros(
    (OUTPUT_SIZE, OUTPUT_SIZE, 4),
    dtype=np.uint8
)

# The Horn calculation produces a result two pixels
# smaller in each dimension. Keep the outer border
# transparent because it has no complete neighborhood.

for channel in range(3):
    interpolated = np.interp(
        slope[valid],
        stops,
        palette[:, channel],
    )

    rgba[1:-1, 1:-1, channel][valid] = (
        np.clip(interpolated, 0, 255).astype(np.uint8)
    )

rgba[1:-1, 1:-1, 3][valid] = OPACITY

# --------------------------------------------------
# 5. EXPORT TRANSPARENT RGBA HEATMAP
# --------------------------------------------------

Image.fromarray(rgba).save(
    OUTPUT,
    optimize=True
)

# --------------------------------------------------
# 6. REPORT
# --------------------------------------------------

valid_values = slope[valid]

print()
print("===================================")
print("SOLARIS SLOPE HEATMAP GENERATED")
print("===================================")
print("Output:", OUTPUT)
print("Dimensions:", OUTPUT_SIZE, "x", OUTPUT_SIZE)
print("Pixel spacing:", round(pixel_spacing, 2), "m")
print("Valid pixels:", len(valid_values))

if len(valid_values) > 0:
    print("Minimum slope:", round(float(np.min(valid_values)), 2), "degrees")
    print("Maximum slope:", round(float(np.max(valid_values)), 2), "degrees")
    print("Mean slope:", round(float(np.mean(valid_values)), 2), "degrees")

print("Colour mapping: continuous 9-stop gradient")
print("No-data pixels: transparent")
print("Safety classification: NOT PERFORMED")
print("===================================")
