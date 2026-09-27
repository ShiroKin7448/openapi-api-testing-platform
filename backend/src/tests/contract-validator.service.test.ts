import { ContractValidatorService } from '../services/contract-validator.service';
import { NormalizedResponse } from '@shared/types';

describe('ContractValidatorService', () => {
  let validator: ContractValidatorService;

  beforeEach(() => {
    validator = new ContractValidatorService();
  });

  const expectedResponses: NormalizedResponse[] = [
    {
      statusCode: '200',
      headers: {
        'X-Rate-Limit': {
          required: true,
          schema: { type: 'string' }
        }
      },
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' }
            }
          }
        }
      }
    },
    {
      statusCode: 'default',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              error: { type: 'string' }
            }
          }
        }
      }
    }
  ];

  it('Should validate a perfectly matching response', () => {
    const result = validator.validateResponse(
      200,
      { 'content-type': 'application/json', 'X-Rate-Limit': '100' },
      { id: '123e4567-e89b-12d3-a456-426614174000', name: 'John Doe' },
      expectedResponses
    );

    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('Should strip charset and normalize Content-Type correctly', () => {
    const result = validator.validateResponse(
      200,
      { 'content-type': 'application/json; charset=utf-8', 'X-Rate-Limit': '100' },
      { id: '123e4567-e89b-12d3-a456-426614174000' },
      expectedResponses
    );

    expect(result.isValid).toBe(true);
  });

  it('Should enforce case-insensitive header checks', () => {
    const result = validator.validateResponse(
      200,
      { 'content-type': 'application/json', 'x-rate-limit': '100' }, // Lowercase in actual
      { id: '123e4567-e89b-12d3-a456-426614174000' },
      expectedResponses
    );

    expect(result.isValid).toBe(true);
  });

  it('Should fail if required header is missing', () => {
    const result = validator.validateResponse(
      200,
      { 'content-type': 'application/json' }, // Missing X-Rate-Limit
      { id: '123e4567-e89b-12d3-a456-426614174000' },
      expectedResponses
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required header: X-Rate-Limit');
  });

  it('Should fail if JSON body violates schema constraints (missing required)', () => {
    const result = validator.validateResponse(
      200,
      { 'content-type': 'application/json', 'X-Rate-Limit': '100' },
      { name: 'Missing ID field' },
      expectedResponses
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('must have required property \'id\''))).toBe(true);
  });

  it('Should fallback to default response if exact status is not defined', () => {
    const result = validator.validateResponse(
      500,
      { 'content-type': 'application/json' },
      { error: 'Internal server error' },
      expectedResponses
    );

    expect(result.isValid).toBe(true);
  });

  it('Should fail if no default exists and status code is completely unknown', () => {
    const strictExpectedResponses: NormalizedResponse[] = [
      { statusCode: '200', content: {} }
    ];

    const result = validator.validateResponse(
      404,
      { 'content-type': 'application/json' },
      {},
      strictExpectedResponses
    );

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('not defined in the OpenAPI spec and no \'default\' exists');
  });
});
