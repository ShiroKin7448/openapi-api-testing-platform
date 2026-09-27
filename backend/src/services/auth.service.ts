import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import { User } from '@shared/types';
import { User as PrismaUser } from '@prisma/client';
import { getJwtSecret } from '../utils/jwtSecret';

const JWT_EXPIRES_IN = '1d';

export class AuthService {
  /**
   * Register a new user
   */
  async register(email: string, passwordRaw: string, name: string): Promise<User> {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('User with this email already exists', 409, true, 'EMAIL_ALREADY_EXISTS');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordRaw, salt);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    });

    return this.excludePassword(user);
  }

  /**
   * Login a user and return a JWT
   */
  async login(email: string, passwordRaw: string): Promise<{ token: string; user: User }> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    const isMatch = await bcrypt.compare(passwordRaw, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }

    const emailStatus = await prisma.$queryRaw<Array<{ emailVerified: boolean }>>`
      SELECT "emailVerified" FROM "User" WHERE "id" = ${user.id} LIMIT 1
    `;
    if (!emailStatus[0]?.emailVerified) {
      throw new AppError('Please verify your email before signing in.', 403, true, 'EMAIL_NOT_VERIFIED');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
    );

    return {
      token,
      user: this.excludePassword(user),
    };
  }

  async getUserById(id: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);
    return this.excludePassword(user);
  }

  /**
   * Helper to exclude password from the User object
   */
  private excludePassword(user: PrismaUser): User {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
