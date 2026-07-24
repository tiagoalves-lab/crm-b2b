import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneOf', async: false })
class ExactlyOneOfConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const [fields] = args.constraints as [string[]];
    const target = args.object as Record<string, unknown>;
    const filled = fields.filter(
      (field) => target[field] !== undefined && target[field] !== null,
    );
    return filled.length === 1;
  }

  defaultMessage(args: ValidationArguments): string {
    const [fields] = args.constraints as [string[]];
    return `Exatamente um dos campos [${fields.join(', ')}] deve ser informado.`;
  }
}

/**
 * Aplicar em UM dos campos do grupo (a checagem em si é sobre o objeto
 * inteiro, não sobre o campo decorado). Usado por CreateTaskDto — Task e
 * Activity têm relação polimórfica (company/contact/opportunity), com
 * exatamente um preenchido garantido por CHECK constraint no Postgres
 * (ver prisma/migrations/20260724120000_init_core_schema). Este decorator
 * dá 400 limpo antes de chegar no banco, em vez de deixar a constraint
 * estourar como erro genérico.
 */
export function ExactlyOneOf(
  fields: string[],
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneOf',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [fields],
      validator: ExactlyOneOfConstraint,
    });
  };
}
