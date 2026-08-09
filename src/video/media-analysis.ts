import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { DemonstrationTimeline, VideoMetadata, VisualObservation } from "./video-types.js";

const execute = promisify(execFile);

export interface MediaInspector { inspect(path: string): Promise<VideoMetadata> }
export interface VideoObservationProvider { analyze(path: string, metadata: VideoMetadata): Promise<DemonstrationTimeline> }

export class FfprobeMediaInspector implements MediaInspector {
  public constructor(private readonly executable = process.env.FFPROBE_EXECUTABLE_PATH ?? "ffprobe") {}

  public async inspect(path: string): Promise<VideoMetadata> {
    const { stdout } = await execute(this.executable, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", path], { timeout: 30_000, maxBuffer: 1_048_576 });
    const parsed: unknown = JSON.parse(stdout);
    if (!record(parsed) || !Array.isArray(parsed.streams) || !record(parsed.streams[0]) || !record(parsed.format)) throw new Error("The video does not contain a supported visual stream.");
    const stream = parsed.streams[0];
    const durationMs = Math.round(Number(parsed.format.duration) * 1000);
    const [numerator, denominator] = String(stream.avg_frame_rate).split("/").map(Number);
    const frameRate = denominator ? Number(numerator) / denominator : Number(numerator);
    const metadata = { durationMs, width: Number(stream.width), height: Number(stream.height), frameRate };
    if (!Number.isFinite(durationMs) || !Number.isFinite(frameRate) || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) throw new Error("The video metadata is invalid.");
    return metadata;
  }
}

export class FfmpegOcrObservationProvider implements VideoObservationProvider {
  public constructor(
    private readonly ffmpeg = process.env.FFMPEG_EXECUTABLE_PATH ?? "ffmpeg",
    private readonly tesseract = process.env.TESSERACT_EXECUTABLE_PATH ?? "tesseract",
  ) {}

  public async analyze(path: string, metadata: VideoMetadata): Promise<DemonstrationTimeline> {
    const directory = await mkdtemp(join(tmpdir(), "doonce-video-"));
    try {
      const intervalSeconds = Math.max(2, Math.ceil(metadata.durationMs / 60_000));
      await execute(this.ffmpeg, ["-v", "error", "-i", path, "-vf", `fps=1/${intervalSeconds},scale='min(1280,iw)':-2`, "-frames:v", "60", join(directory, "frame-%06d.png")], { timeout: 120_000, maxBuffer: 1_048_576 });
      const frames = (await readdir(directory)).filter((name) => name.endsWith(".png")).sort();
      const observations: VisualObservation[] = [];
      let priorText = "";
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index] as string;
        const text = await ocr(this.tesseract, join(directory, frame));
        const normalized = text.replace(/\s+/g, " ").trim().slice(0, 2000);
        if (!normalized || similarityKey(normalized) === similarityKey(priorText)) continue;
        observations.push({
          id: randomUUID(),
          sequence: observations.length,
          atMs: Math.min(metadata.durationMs, index * intervalSeconds * 1000),
          description: observations.length === 0 ? "Visible starting state" : "Visible page content changed",
          textHints: normalized.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5),
          confidence: 0.35,
          frameReference: `frame:${index + 1}`,
        });
        priorText = normalized;
      }
      return {
        schemaVersion: 1,
        format: "doonce.demonstration-timeline.v1",
        source: "pure-video",
        durationMs: metadata.durationMs,
        observations,
        uncertainties: [{ code: "video.semantic-calibration-required", message: "Visual changes must be mapped to live browser elements before this demonstration can become a workflow.", observationIds: observations.map((item) => item.id) }],
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function ocr(executable: string, path: string): Promise<string> {
  try {
    return (await execute(executable, [path, "stdout", "--psm", "6"], { timeout: 20_000, maxBuffer: 2_097_152 })).stdout;
  } catch {
    return "";
  }
}

function similarityKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 500); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
