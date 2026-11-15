import csv
import math
import sys

writer = csv.writer(sys.stdout)
writer.writerow([
    "longitude", "latitude",
    "average_temperature_k",
    "maximum_temperature_k",
    "ice_depth_m"
])

count = 0
kept = 0

for row in csv.reader(sys.stdin):
    if len(row) != 15:
        continue

    try:
        lon = float(row[9])
        lat = float(row[10])
        avg = float(row[12])
        maximum = float(row[13])
        depth = float(row[14])
    except ValueError:
        continue

    count += 1

    if -90 <= lat <= -80 and all(map(math.isfinite, [lon, lat, avg, maximum])):
        writer.writerow([
            lon, lat, avg, maximum,
            depth if depth >= 0 else ""
        ])
        kept += 1

    if count % 100000 == 0:
        print(f"Scanned {count:,}; retained {kept:,}", file=sys.stderr)

print(f"Finished: {count:,} scanned, {kept:,} retained", file=sys.stderr)
