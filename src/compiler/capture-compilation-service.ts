import type { AuthenticatedUser } from "../auth/auth-service.js";
import { CaptureService } from "../capture/capture-service.js";
import type { WorkflowCompilation } from "../contracts/protocol.js";
import { CanonicalWorkflowService, type CanonicalWorkflowDraft, type CanonicalWorkflowDraftMetadata } from "../workflow/canonical-workflow-service.js";
import { CaptureWorkflowCompiler } from "./capture-workflow-compiler.js";

export class CaptureCompilationNotFoundError extends Error {}

export interface CaptureCompilationResult {
  compilation: WorkflowCompilation;
  workflow: CanonicalWorkflowDraft;
}

export class CaptureCompilationService {
  public constructor(
    private readonly captures: CaptureService,
    private readonly compiler: CaptureWorkflowCompiler,
    private readonly workflows: CanonicalWorkflowService,
  ) {}

  public async compile(user: AuthenticatedUser, sessionId: string): Promise<CaptureCompilationResult> {
    const session = await this.captures.findSession(user, sessionId);
    if (!session) throw new CaptureCompilationNotFoundError("Capture session was not found.");
    const compilation = await this.compiler.compile(session);
    const metadata: CanonicalWorkflowDraftMetadata = {
      source: "capture",
      captureSessionId: compilation.captureSessionId,
      compilerVersion: compilation.compilerVersion,
      sourceDigest: compilation.sourceDigest,
      compilation,
    };
    const workflow = await this.workflows.createDraft(user, compilation.workflow, metadata);
    return { compilation, workflow };
  }
}
