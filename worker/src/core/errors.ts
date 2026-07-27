export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(resource: string): AppError {
  return new AppError(404, "NOT_FOUND", `${resource}不存在`);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}
