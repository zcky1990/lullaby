import { describe, expect, it } from "vitest";
import { ApiError, formatApiError } from "./api-error";

describe("ApiError", () => {
  it("carries status and optional body", () => {
    const err = new ApiError(404, "Not found", { error: "missing" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err.body).toEqual({ error: "missing" });
  });

  it("formats message and issues from the API body", () => {
    const err = new ApiError(400, "invalid_workflow", {
      error: "invalid_workflow",
      message: "Workflow tidak valid.",
      issues: ["root: Unrecognized key(s) in object: 'params'", "steps.0.env: Expected object"],
    });
    expect(formatApiError(err)).toBe(
      "Workflow tidak valid.\nroot: Unrecognized key(s) in object: 'params'\nsteps.0.env: Expected object",
    );
  });
});
