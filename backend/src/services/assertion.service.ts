/**
 * Safe evaluator for user-defined assertions such as:
 *   status == 200
 *   headers['content-type'] contains 'application/json'
 *   body.total > 0 && body.items.length >= 1
 *   responseTime < 500
 *   body.email matches '^.+@.+$'
 *   exists body.id
 *
 * No `eval` / `Function` is used: expressions are tokenized and parsed by a small
 * recursive-descent parser that can only read values from the response context.
 */

export interface AssertionDefinition {
  expression: string;
  description?: string;
}

export interface AssertionResult {
  expression: string;
  description?: string;
  passed: boolean;
  actual?: unknown;
  error?: string;
}

export interface AssertionContext {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
  responseTime: number;
}

type TokenType = 'number' | 'string' | 'ident' | 'op' | 'punct' | 'eof';
interface Token { type: TokenType; value: string; pos: number; }

const OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '!'];
const WORD_OPERATORS = new Set(['contains', 'matches', 'startsWith', 'endsWith', 'in', 'exists', 'and', 'or', 'not']);
const ROOTS = new Set(['status', 'headers', 'body', 'responseTime', 'response']);
const MAX_EXPRESSION_LENGTH = 500;

class AssertionSyntaxError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] ?? '') && !isValueToken(tokens[tokens.length - 1]))) {
      let j = i + 1;
      while (j < input.length && /[0-9._eE]/.test(input[j])) j += 1;
      tokens.push({ type: 'number', value: input.slice(i, j), pos: i });
      i = j; continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1; let value = '';
      while (j < input.length && input[j] !== ch) {
        if (input[j] === '\\' && j + 1 < input.length) { value += input[j + 1]; j += 2; continue; }
        value += input[j]; j += 1;
      }
      if (j >= input.length) throw new AssertionSyntaxError(`Chuỗi chưa đóng tại vị trí ${i}`);
      tokens.push({ type: 'string', value, pos: i });
      i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_$-]/.test(input[j])) {
        // Allow hyphens only when followed by an identifier char (e.g. content-type after a dot)
        if (input[j] === '-' && !/[A-Za-z0-9_]/.test(input[j + 1] ?? '')) break;
        j += 1;
      }
      const word = input.slice(i, j);
      tokens.push({ type: WORD_OPERATORS.has(word) ? 'op' : 'ident', value: word, pos: i });
      i = j; continue;
    }
    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (op) { tokens.push({ type: 'op', value: op, pos: i }); i += op.length; continue; }
    if ('.[]()'.includes(ch)) { tokens.push({ type: 'punct', value: ch, pos: i }); i += 1; continue; }
    throw new AssertionSyntaxError(`Ký tự không hợp lệ '${ch}' tại vị trí ${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: input.length });
  return tokens;
}

function isValueToken(token: Token | undefined): boolean {
  if (!token) return false;
  return token.type === 'number' || token.type === 'string' || token.type === 'ident' || token.value === ']' || token.value === ')';
}

const MISSING = Symbol('missing');

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly context: AssertionContext) {}

  parse(): unknown {
    const value = this.parseOr();
    if (this.peek().type !== 'eof') throw new AssertionSyntaxError(`Dư ký tự '${this.peek().value}' tại vị trí ${this.peek().pos}`);
    return value;
  }

  private peek(): Token { return this.tokens[this.index]; }
  private next(): Token { const token = this.tokens[this.index]; this.index += 1; return token; }
  private matchOp(...values: string[]): string | undefined {
    const token = this.peek();
    if (token.type === 'op' && values.includes(token.value)) { this.index += 1; return token.value; }
    return undefined;
  }
  private expectPunct(value: string): void {
    const token = this.next();
    if (token.type !== 'punct' || token.value !== value) throw new AssertionSyntaxError(`Thiếu '${value}' tại vị trí ${token.pos}`);
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.matchOp('||', 'or')) { const right = this.parseAnd(); left = truthy(left) || truthy(right); }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.matchOp('&&', 'and')) { const right = this.parseNot(); left = truthy(left) && truthy(right); }
    return left;
  }

  private parseNot(): unknown {
    if (this.matchOp('!', 'not')) return !truthy(this.parseNot());
    if (this.matchOp('exists')) { const value = this.parsePrimary(); return value !== MISSING && value !== undefined && value !== null; }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const op = this.matchOp('===', '!==', '==', '!=', '>=', '<=', '>', '<', 'contains', 'matches', 'startsWith', 'endsWith', 'in');
    if (!op) return left === MISSING ? undefined : left;
    const right = this.parsePrimary();
    return compare(op, left === MISSING ? undefined : left, right === MISSING ? undefined : right);
  }

  private parsePrimary(): unknown {
    const token = this.next();
    if (token.type === 'punct' && token.value === '(') {
      const value = this.parseOr();
      this.expectPunct(')');
      return value;
    }
    if (token.type === 'number') {
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new AssertionSyntaxError(`Số không hợp lệ '${token.value}'`);
      return value;
    }
    if (token.type === 'string') return token.value;
    if (token.type === 'ident') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      if (token.value === 'undefined') return undefined;
      if (!ROOTS.has(token.value)) throw new AssertionSyntaxError(`Biến '${token.value}' không tồn tại. Dùng: status, headers, body, responseTime`);
      let current: unknown = this.root(token.value);
      while (this.peek().type === 'punct' && (this.peek().value === '.' || this.peek().value === '[')) {
        const punct = this.next();
        let key: string | number;
        if (punct.value === '.') {
          const name = this.next();
          if (name.type !== 'ident' && name.type !== 'op') throw new AssertionSyntaxError(`Thiếu tên thuộc tính sau '.' tại vị trí ${punct.pos}`);
          key = name.value;
        } else {
          const inner = this.next();
          if (inner.type === 'string') key = inner.value;
          else if (inner.type === 'number') key = Number(inner.value);
          else throw new AssertionSyntaxError(`Chỉ số trong [] phải là chuỗi hoặc số (vị trí ${inner.pos})`);
          this.expectPunct(']');
        }
        current = readProperty(current, key);
      }
      return current;
    }
    throw new AssertionSyntaxError(`Không mong đợi '${token.value || 'kết thúc biểu thức'}' tại vị trí ${token.pos}`);
  }

  private root(name: string): unknown {
    if (name === 'status') return this.context.status;
    if (name === 'headers') return this.context.headers;
    if (name === 'body') return this.context.body;
    if (name === 'responseTime') return this.context.responseTime;
    return { status: this.context.status, headers: this.context.headers, body: this.context.body, responseTime: this.context.responseTime };
  }
}

function readProperty(value: unknown, key: string | number): unknown {
  if (value === MISSING || value === undefined || value === null) return MISSING;
  if (key === 'length' && (typeof value === 'string' || Array.isArray(value))) return value.length;
  if (Array.isArray(value)) {
    const index = typeof key === 'number' ? key : Number(key);
    return Number.isInteger(index) && index >= 0 && index < value.length ? value[index] : MISSING;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = String(key);
    if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
    // Header names are case-insensitive
    const lower = name.toLowerCase();
    const match = Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
    return match === undefined ? MISSING : record[match];
  }
  return MISSING;
}

function truthy(value: unknown): boolean {
  return value !== MISSING && Boolean(value);
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || left === undefined || right === undefined) return left == right; // eslint-disable-line eqeqeq
  if (typeof left === 'number' || typeof right === 'number') {
    const a = Number(left); const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') return String(left) === String(right);
  if (typeof left === 'object' && typeof right === 'object') return JSON.stringify(left) === JSON.stringify(right);
  return String(left) === String(right);
}

function compare(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': return looseEquals(left, right);
    case '!=': return !looseEquals(left, right);
    case '>': case '<': case '>=': case '<=': {
      if (left === undefined || left === null || right === undefined || right === null) return false;
      const bothStrings = typeof left === 'string' && typeof right === 'string' && !Number.isFinite(Number(left));
      const a = bothStrings ? left : Number(left);
      const b = bothStrings ? right : Number(right);
      if (!bothStrings && (!Number.isFinite(a as number) || !Number.isFinite(b as number))) return false;
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      return a <= b;
    }
    case 'contains': {
      if (Array.isArray(left)) return left.some((item) => looseEquals(item, right));
      if (typeof left === 'string') return left.toLowerCase().includes(String(right).toLowerCase());
      if (left && typeof left === 'object') return Object.prototype.hasOwnProperty.call(left, String(right));
      return false;
    }
    case 'in': return Array.isArray(right) ? right.some((item) => looseEquals(item, left)) : typeof right === 'string' && typeof left === 'string' && right.includes(left);
    case 'startsWith': return typeof left === 'string' && left.startsWith(String(right));
    case 'endsWith': return typeof left === 'string' && left.endsWith(String(right));
    case 'matches': {
      if (typeof left !== 'string' && typeof left !== 'number') return false;
      const pattern = String(right);
      if (pattern.length > 200) throw new AssertionSyntaxError('Biểu thức regex quá dài (tối đa 200 ký tự)');
      try { return new RegExp(pattern).test(String(left).slice(0, 10000)); }
      catch { throw new AssertionSyntaxError(`Regex không hợp lệ: ${pattern}`); }
    }
    default: throw new AssertionSyntaxError(`Toán tử không hỗ trợ: ${op}`);
  }
}

/** Reads the value of the left-most path in the expression so failures can show "actual". */
function describeActual(expression: string, context: AssertionContext): unknown {
  const match = /^\s*(?:!|not\s+|exists\s+)?((?:status|headers|body|responseTime)(?:\.[A-Za-z0-9_$-]+|\[[^\]]+\])*)/.exec(expression);
  if (!match) return undefined;
  try {
    const value = new Parser(tokenize(match[1]), context).parse();
    return value === MISSING ? undefined : value;
  } catch { return undefined; }
}

export class AssertionService {
  /** Throws a descriptive error if the expression cannot be parsed. */
  validateSyntax(expression: string): void {
    if (!expression.trim()) throw new AssertionSyntaxError('Biểu thức không được để trống');
    if (expression.length > MAX_EXPRESSION_LENGTH) throw new AssertionSyntaxError(`Biểu thức tối đa ${MAX_EXPRESSION_LENGTH} ký tự`);
    new Parser(tokenize(expression), { status: 200, headers: {}, body: {}, responseTime: 0 }).parse();
  }

  evaluate(expression: string, context: AssertionContext): boolean {
    if (expression.length > MAX_EXPRESSION_LENGTH) throw new AssertionSyntaxError(`Biểu thức tối đa ${MAX_EXPRESSION_LENGTH} ký tự`);
    return truthy(new Parser(tokenize(expression), context).parse());
  }

  evaluateAll(assertions: AssertionDefinition[], context: AssertionContext): AssertionResult[] {
    return assertions.map((assertion) => {
      try {
        const passed = this.evaluate(assertion.expression, context);
        return { expression: assertion.expression, description: assertion.description, passed, actual: passed ? undefined : truncate(describeActual(assertion.expression, context)) };
      } catch (error) {
        return { expression: assertion.expression, description: assertion.description, passed: false, error: error instanceof Error ? error.message : 'Lỗi không xác định' };
      }
    });
  }
}

function truncate(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return undefined;
  return text.length > 300 ? `${text.slice(0, 300)}…` : value;
}

export function parseAssertions(value: unknown): AssertionDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AssertionDefinition | null => {
      if (typeof item === 'string') return item.trim() ? { expression: item.trim() } : null;
      if (item && typeof item === 'object' && typeof (item as { expression?: unknown }).expression === 'string') {
        const record = item as { expression: string; description?: unknown };
        return record.expression.trim() ? { expression: record.expression.trim(), description: typeof record.description === 'string' ? record.description : undefined } : null;
      }
      return null;
    })
    .filter((item): item is AssertionDefinition => item !== null);
}

export const assertionService = new AssertionService();
export { AssertionSyntaxError };
