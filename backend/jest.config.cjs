module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@shared/types$': '<rootDir>/../shared/types/index.ts' },
  testMatch: ['**/src/tests/**/*.test.ts'],
  clearMocks: true,
};
