const durationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

interface Histogram {
  count: number;
  sum: number;
  buckets: number[];
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();

  public increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  public set(name: string, labels: Record<string, string>, value: number): void {
    if (!Number.isFinite(value)) return;
    this.gauges.set(metricKey(name, labels), value);
  }

  public observe(name: string, labels: Record<string, string>, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const key = metricKey(name, labels);
    const histogram = this.histograms.get(key) ?? { count: 0, sum: 0, buckets: durationBuckets.map(() => 0) };
    histogram.count += 1;
    histogram.sum += seconds;
    durationBuckets.forEach((bucket, index) => { if (seconds <= bucket) histogram.buckets[index]! += 1; });
    this.histograms.set(key, histogram);
  }

  public prometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.counters].sort()) lines.push(`${key} ${value}`);
    for (const [key, value] of [...this.gauges].sort()) lines.push(`${key} ${value}`);
    for (const [key, histogram] of [...this.histograms].sort()) {
      const { name, labels } = splitMetricKey(key);
      durationBuckets.forEach((bucket, index) => lines.push(`${name}_bucket${mergeLabels(labels, { le: String(bucket) })} ${histogram.buckets[index]}`));
      lines.push(`${name}_bucket${mergeLabels(labels, { le: "+Inf" })} ${histogram.count}`);
      lines.push(`${name}_sum${labels} ${histogram.sum}`);
      lines.push(`${name}_count${labels} ${histogram.count}`);
    }
    return `${lines.join("\n")}\n`;
  }

  public reset(): void { this.counters.clear(); this.gauges.clear(); this.histograms.clear(); }
}

export const operationalMetrics = new MetricsRegistry();

function metricKey(name: string, labels: Record<string, string>): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Metric names must use lower-case Prometheus syntax.");
  return `${name}${labelsText(labels)}`;
}
function labelsText(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? "" : `{${entries.map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`).join(",")}}`;
}
function splitMetricKey(key: string): { name: string; labels: string } {
  const index = key.indexOf("{");
  return index < 0 ? { name: key, labels: "" } : { name: key.slice(0, index), labels: key.slice(index) };
}
function mergeLabels(existing: string, extra: Record<string, string>): string {
  const extraText = labelsText(extra);
  if (!existing) return extraText;
  return `{${existing.slice(1, -1)},${extraText.slice(1, -1)}}`;
}
