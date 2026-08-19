import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Defesa em profundidade — os services já checam as mesmas condições antes
// de escrever (ver ex. OpportunityService), então isso normalmente não
// dispara em uso normal da API. Existe pra nunca deixar uma constraint do
// Postgres vazar como 500 cru se algum caminho novo esquecer de checar.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const request = host
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    // Registrado sempre (não só no caso default abaixo) — antes disso o
    // erro real do Postgres era engolido em silêncio, só o "Erro
    // inesperado no banco de dados" genérico chegava ao cliente e não
    // havia nenhum jeito de diagnosticar a causa a partir dos logs do
    // Railway (achado depurando um 500 real em POST /raw-leads/import-contacts,
    // 2026-08-06).
    this.logger.error(
      `${request?.method ?? '?'} ${request?.url ?? '?'} — Prisma ${exception.code}: ${exception.message}` +
        (exception.meta ? ` | meta=${JSON.stringify(exception.meta)}` : ''),
    );

    const response = host.switchToHttp().getResponse<Response>();
    const httpException = this.toHttpException(exception);
    response
      .status(httpException.getStatus())
      .json(httpException.getResponse());
  }

  private toHttpException(
    exception: Prisma.PrismaClientKnownRequestError,
  ): HttpException {
    switch (exception.code) {
      case 'P2002': {
        const target = exception.meta?.target;
        let fields = 'campo(s) único(s)';
        if (Array.isArray(target)) {
          fields = target.join(', ');
        } else if (typeof target === 'string') {
          fields = target;
        }
        return new ConflictException(
          `Já existe um registro com o mesmo valor único (${fields}).`,
        );
      }
      case 'P2025':
        return new NotFoundException('Registro não encontrado.');
      case 'P2003':
        return new BadRequestException(
          'Referência inválida (chave estrangeira não encontrada).',
        );
      default:
        return new InternalServerErrorException(
          'Erro inesperado no banco de dados.',
        );
    }
  }
}
