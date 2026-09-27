export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode: number, isOperational = true, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SSRFError extends AppError {
  constructor(message: string = 'SSRF Blocked: Attempted to access a restricted or private IP address.') {
    super(message, 403, true);
    this.name = 'SSRFError';
  }
}
