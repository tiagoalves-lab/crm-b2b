import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Uma linha por requisição no log do Railway: método, rota, status e
// duração (2026-09-04). Até então o backend não registrava requisição
// nenhuma — só o boot do Nest — e "o CRM está lento" não tinha número.
// Registrado via app.use() em main.ts (não via MiddlewareConsumer, pra não
// depender da sintaxe de wildcard do Express 5).
//
// Nunca loga header, corpo ou token — só o que já aparece na URL.
export function httpTiming(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  const logger = new Logger('HTTP');
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`,
      );
    });
    next();
  };
}
