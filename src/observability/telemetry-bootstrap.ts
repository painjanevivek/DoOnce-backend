import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
export const telemetrySdk = endpoint ? new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "doonce-api",
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
}) : undefined;

telemetrySdk?.start();
