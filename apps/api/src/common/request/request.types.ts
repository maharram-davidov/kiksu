import type { Request } from "express";

/**
 * Minimal shape we actually need from an inbound request in the `common/` layer.
 * Kept separate from `express.Request` so the shared helpers stay platform-agnostic —
 * this project runs on Express (`@nestjs/platform-express`), but nothing under
 * `common/` should hard-couple to that beyond "requests have headers".
 */
export interface MinimalRequest {
  headers: Request["headers"];
}
