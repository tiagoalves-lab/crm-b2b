import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
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
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
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
