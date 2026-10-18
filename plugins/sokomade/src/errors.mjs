export class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
export function publicError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message, ...error.details };
  return { code: 'INTERNAL_ERROR', message: '処理できませんでした。時間をおいて再試行してください。' };
}
export function invariant(value, code, message) {
  if (!value) throw new AppError(code, message);
}
