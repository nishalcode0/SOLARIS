
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

SOURCE = "public/data/LPSR_80S_20MPP_ADJ.TIF"
OUTPUT = "public/data/lola-south-pole-psr.png"

SIZE = 2400

with rasterio.open(SOURCE) as src:
    data = src.read(
        1,
        out_shape=(SIZE, SIZE),
        resampling=Resampling.nearest,
        masked=True,
    )

    values = np.asarray(data.data)
    valid = ~np.ma.getmaskarray(data) & np.isfinite(values)

    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)

    # Raw value 0 — ice-grey visualization
    rgba[valid & (values == 0)] = [190, 205, 215, 110]

    # Raw value 1 — cantaloupe visualization
    rgba[valid & (values == 1)] = [255, 147, 90, 190]

    # Unexpected values remain transparent.
    rgba[valid & (values != 0) & (values != 1)] = [220, 70, 70, 190]

Image.fromarray(rgba, "RGBA").save(OUTPUT, optimize=True)

print("PSR visualization created:", OUTPUT)
print("Dimensions:", SIZE, "x", SIZE)
print("Raw value 0 pixels:", int(np.count_nonzero(valid & (values == 0))))
print("Raw value 1 pixels:", int(np.count_nonzero(valid & (values == 1))))
print("Other valid values:", int(np.count_nonzero(valid & (values != 0) & (values != 1))))
print("NoData pixels:", int(np.count_nonzero(~valid)))
