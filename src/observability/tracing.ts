import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("doonce", "1.0.0");

export function startSpan(name: string, attributes: Attributes = {}): Span {
  return tracer.startSpan(name, { attributes });
}

export async function withSpan<T>(name: string, attributes: Attributes, work: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await work();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : "UnknownError" });
      if (error instanceof Error) span.recordException({ name: error.name, message: error.name });
      throw error;
    } finally { span.end(); }
  });
}

export function finishSpan(span: Span, statusCode: number): void {
  span.setAttribute("http.response.status_code", statusCode);
  span.setStatus({ code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  span.end();
}
