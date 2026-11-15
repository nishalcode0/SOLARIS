
import { useEffect, useMemo, useState } from "react";

type Props = {
  sites: Record<string, unknown>[];
};

type PlotResponse = {
  image: string;
  plotCount: number;
  engine: string;
};

export default function MatplotlibComparison({ sites }: Props) {
  const [result, setResult] = useState<PlotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const payload = useMemo(
    () => JSON.stringify({ sites }),
    [sites]
  );

  useEffect(() => {
    if (!sites.length) {
      setResult(null);
      setError("");
      return;
    }

    const controller = new AbortController();

    async function generatePlots() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}/api/comparison-plot`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Matplotlib server returned HTTP ${response.status}`);
        }

        const data: PlotResponse = await response.json();

        if (!data.image?.startsWith("data:image/png;base64,")) {
          throw new Error("The server returned an invalid plot image.");
        }

        setResult(data);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    generatePlots();

    return () => controller.abort();
  }, [payload, sites.length]);

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-widest text-[#172B4D]">
            SCIENTIFIC COMPARISON
          </h3>
          <p className="mt-1 text-xs text-[#64748B]">
            Python Matplotlib · Lunar site analysis
          </p>
        </div>

        <span className="rounded-full border border-[#CBD5E1] px-3 py-1 text-xs text-[#172B4D]">
          {loading ? "GENERATING" : result ? `${result.plotCount} PLOTS` : "READY"}
        </span>
      </div>

      {loading && (
        <div className="rounded-xl border border-[#CBD5E1] bg-[#F1F3F5] p-8 text-center">
          <div className="text-sm font-medium text-[#172B4D]">
            Generating scientific plots…
          </div>
          <p className="mt-2 text-xs text-[#64748B]">
            Processing the selected lunar sites
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#D97757] bg-[#FFF1E9] p-4">
          <p className="text-sm font-semibold text-[#8B3525]">
            Matplotlib service error
          </p>
          <p className="mt-1 text-xs text-[#8B3525]">{error}</p>
          <p className="mt-2 text-xs text-[#64748B]">
            Check that the Python server is running on port 8000.
          </p>
        </div>
      )}

      {result && !loading && (
        <div className="overflow-hidden rounded-xl border border-[#CBD5E1] bg-white">
          <img
            src={result.image}
            alt="Matplotlib scientific comparison dashboard for lunar landing sites"
            className="block h-auto w-full"
          />
        </div>
      )}

      <p className="text-xs leading-relaxed text-[#64748B]">
        Plots visualize supplied LOLA terrain measurements and calculated
        geometric quantities. Matplotlib renders the results; it does not
        independently validate the underlying scientific calculations.
        Missing measurements must remain unavailable rather than being
        interpreted as zero.
      </p>
    </section>
  );
}
