import type { NextFunction, Request, Response } from 'express';

/** API エラー。ステータスコードとメッセージを持つ。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what}が見つかりません`);
export const badRequest = (message: string): HttpError => new HttpError(400, message);

/** async ハンドラの例外を Express のエラーハンドラへ流す。 */
export function wrap(
  handler: (req: Request, res: Response) => unknown | Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    try {
      const result = handler(req, res);
      if (result instanceof Promise) result.catch(next);
    } catch (error) {
      next(error);
    }
  };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (status >= 500) console.error('[api]', error);
  res.status(status).json({ error: message });
}
