import json
from shapely.geometry import shape, mapping

SOURCE = "public/data/lunar-psr.geojson"
OUTPUT = "public/data/lunar-psr-display.geojson"

with open(SOURCE) as f:
    data = json.load(f)

features = []

for feature in data["features"]:
    geom = shape(feature["geometry"])

    # Simplify while preserving polygon topology.
    simplified = geom.simplify(150, preserve_topology=True)

    if simplified.is_empty:
        continue

    features.append({
        "type": "Feature",
        "geometry": mapping(simplified),
        "properties": feature["properties"]
    })

result = {
    "type": "FeatureCollection",
    "features": features
}

with open(OUTPUT, "w") as f:
    json.dump(result, f, separators=(",", ":"))

print("Original features:", len(data["features"]))
print("Display features:", len(features))
print("Original size: 27.2 MB")
import os
print("Display size:", round(os.path.getsize(OUTPUT) / 1024 / 1024, 2), "MB")
