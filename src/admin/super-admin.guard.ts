import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.user?.platformRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access is required');
    }
    return true;
  }
}
