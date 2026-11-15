
from io import BytesIO
import base64
from datetime import datetime
import os

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional


app = FastAPI(title="SOLARIS Scientific Plot Service")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Site(BaseModel):
    name: str
    elevationM: Optional[float] = None
    slopeDeg: Optional[float] = None
    horizonBins: list[dict] = []
    illuminationSamples: list[dict] = []
    illuminationPercent: Optional[float] = None
    earthElevationDeg: Optional[float] = None
    earthAzimuthDeg: Optional[float] = None
    terrainClearanceDeg: Optional[float] = None
    earthVisibility: Optional[str] = None
    psrStatus: Optional[str] = None
    decisionStatus: Optional[str] = None
    decisionScore: Optional[float] = None
    coveragePercent: Optional[float] = None


class ComparisonRequest(BaseModel):
    sites: list[Site]


def available(values):
    return [
        (index, value)
        for index, value in enumerate(values)
        if value is not None and np.isfinite(value)
    ]


def plot_values(ax, values, names, title, ylabel):
    valid = available(values)

    ax.set_title(title, loc="left", fontweight="bold")
    ax.set_ylabel(ylabel)
    ax.grid(axis="y", alpha=0.2)

    if not valid:
        ax.text(
            0.5, 0.5, "DATA UNAVAILABLE",
            ha="center", va="center",
            transform=ax.transAxes
        )
        return

    positions = [item[0] for item in valid]
    measurements = [item[1] for item in valid]

    ax.bar(positions, measurements)
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, rotation=20, ha="right")


@app.post("/api/comparison-plot")
def comparison_plot(request: ComparisonRequest):
    sites = request.sites[:3]

    if not sites:
        return {"error": "No comparison sites supplied."}

    names = [site.name for site in sites]

    fig, axes = plt.subplots(3, 3, figsize=(17, 13))
    fig.suptitle(
        "SOLARIS | Lunar Candidate Scientific Comparison",
        fontsize=17,
        fontweight="bold"
    )

    # 1. Solar elevation through time
    ax = axes[0, 0]
    ax.set_title("Solar elevation over time", loc="left", fontweight="bold")
    ax.set_ylabel("Elevation (degrees)")
    ax.axhline(0, linewidth=1, linestyle="--")
    ax.grid(alpha=0.2)

    plotted = False
    for site in sites:
        samples = site.illuminationSamples
        if len(samples) < 2:
            continue

        times = []
        elevations = []

        for sample in samples:
            try:
                times.append(datetime.fromisoformat(
                    sample["timestamp"].replace("Z", "+00:00")
                ))
                elevations.append(float(sample["solarElevationDeg"]))
            except (KeyError, ValueError, TypeError):
                continue

        if len(times) >= 2:
            ax.plot(times, elevations, marker=".", label=site.name)
            plotted = True

    if plotted:
        ax.legend(fontsize=8)
        fig.autofmt_xdate()
    else:
        ax.text(0.5, 0.5, "DATA UNAVAILABLE",
                ha="center", va="center", transform=ax.transAxes)

    # 2. Elevation
    plot_values(
        axes[0, 1],
        [site.elevationM for site in sites],
        names,
        "LOLA surface elevation",
        "Elevation (m)"
    )

    # 3. Slope
    plot_values(
        axes[0, 2],
        [site.slopeDeg for site in sites],
        names,
        "Local terrain slope",
        "Slope (degrees)"
    )

    # 4. Terrain horizon profiles
    ax = axes[1, 0]
    ax.set_title("Terrain horizon by azimuth", loc="left", fontweight="bold")
    ax.set_xlabel("Azimuth (degrees)")
    ax.set_ylabel("Horizon elevation (degrees)")
    ax.grid(alpha=0.2)

    plotted = False
    for site in sites:
        bins = site.horizonBins
        valid_bins = [
            item for item in bins
            if item.get("horizonElevationDeg") is not None
            and np.isfinite(item["horizonElevationDeg"])
        ]

        if valid_bins:
            ax.plot(
                [item["azimuthDeg"] for item in valid_bins],
                [item["horizonElevationDeg"] for item in valid_bins],
                marker=".",
                label=site.name
            )
            plotted = True

    if plotted:
        ax.legend(fontsize=8)
    else:
        ax.text(0.5, 0.5, "DATA UNAVAILABLE",
                ha="center", va="center", transform=ax.transAxes)

    # 5. PSR classification
    ax = axes[1, 1]
    ax.set_title("Mapped PSR classification", loc="left", fontweight="bold")
    psr_values = [
        1 if site.psrStatus == "inside-mapped-psr"
        else 0 if site.psrStatus == "outside-mapped-psr"
        else np.nan
        for site in sites
    ]
    valid = [
        (i, value) for i, value in enumerate(psr_values)
        if np.isfinite(value)
    ]

    if valid:
        ax.bar(
            [i for i, _ in valid],
            [value for _, value in valid]
        )
        ax.set_xticks(range(len(names)))
        ax.set_xticklabels(names, rotation=20, ha="right")
        ax.set_yticks([0, 1], ["Outside", "Inside"])
    else:
        ax.text(0.5, 0.5, "DATA UNAVAILABLE",
                ha="center", va="center", transform=ax.transAxes)

    # 6. Earth geometry
    plot_values(
        axes[1, 2],
        [site.earthElevationDeg for site in sites],
        names,
        "Earth elevation geometry",
        "Elevation (degrees)"
    )

    # 7. Earth terrain clearance
    plot_values(
        axes[2, 0],
        [site.terrainClearanceDeg for site in sites],
        names,
        "Earth line-of-sight terrain clearance",
        "Clearance (degrees)"
    )

    # 8. Illumination percentage
    plot_values(
        axes[2, 1],
        [site.illuminationPercent for site in sites],
        names,
        "24-hour geometric illumination",
        "Illumination (%)"
    )

    # 9. Mission screening
    ax = axes[2, 2]
    ax.set_title("Preliminary mission screening", loc="left", fontweight="bold")

    scores = [site.decisionScore for site in sites]
    valid = available(scores)

    if valid:
        ax.bar(
            [i for i, _ in valid],
            [value for _, value in valid]
        )
        ax.set_xticks(range(len(names)))
        ax.set_xticklabels(names, rotation=20, ha="right")
        ax.set_ylabel("Screening score (/100)")
        ax.set_ylim(0, 100)
    else:
        ax.text(
            0.5, 0.5,
            "SCORE UNAVAILABLE\n(incomplete criteria or hard failure)",
            ha="center", va="center",
            transform=ax.transAxes
        )

    fig.text(
        0.02, 0.01,
        "Sources: supplied SOLARIS analysis results. "
        "PSR membership does not establish water-ice presence. "
        "Earth geometry is not an RF link budget. "
        "Screening is not landing certification.",
        fontsize=8
    )

    plt.tight_layout(rect=[0, 0.035, 1, 0.96])

    output = BytesIO()
    fig.savefig(output, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)

    encoded = base64.b64encode(output.getvalue()).decode("ascii")

    return {
        "image": f"data:image/png;base64,{encoded}",
        "plotCount": 9,
        "engine": "Python Matplotlib"
    }
