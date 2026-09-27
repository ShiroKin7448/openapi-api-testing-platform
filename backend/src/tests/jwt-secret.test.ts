import { getJwtSecret } from '../utils/jwtSecret';
import { AppError } from '../utils/AppError';

describe('JWT secret configuration', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('has no hard-coded fallback when the secret is missing or weak', () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(AppError);
    process.env.JWT_SECRET = 'too-short';
    expect(() => getJwtSecret()).toThrow(AppError);
  });

  it('returns a configured secret with sufficient entropy length', () => {
    process.env.JWT_SECRET = 'security-audit-secret-with-at-least-32-characters';
    expect(getJwtSecret()).toBe(process.env.JWT_SECRET);
  });
});
