import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const token = this.extractToken(request.headers['authorization']);
    if (!token) throw new UnauthorizedException('Missing token');
    try {
      const payload = this.jwtService.verify<{ userId: string }>(token, {
        secret: process.env.JWT_SECRET ?? 'change-this-in-production',
      });
      request.user = { userId: payload.userId };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(header: string | undefined): string | null {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }
}
