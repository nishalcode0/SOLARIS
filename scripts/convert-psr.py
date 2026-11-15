
import shapefile
import json

source = "public/data/LPSR_80S_20MPP_ADJ_1km2"
output = "public/data/lunar-psr.geojson"

reader = shapefile.Reader(source)
fields = [field[0] for field in reader.fields[1:]]

features = []

for shape_record in reader.iterShapeRecords():
    geometry = shape_record.shape.__geo_interface__
    properties = dict(zip(fields, shape_record.record))

    features.append({
        "type": "Feature",
        "geometry": geometry,
        "properties": properties
    })

collection = {
    "type": "FeatureCollection",
    "features": features
}

with open(output, "w") as file:
    json.dump(collection, file)

print("Features:", len(features))
print("Output:", output)
