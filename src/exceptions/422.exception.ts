import { HttpStatus } from '@api/routes/index.router';

export class UnprocessableEntityException {
  constructor(...objectError: any[]) {
    throw {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'Unprocessable Entity',
      message: objectError.length > 0 ? objectError : undefined,
    };
  }
}
