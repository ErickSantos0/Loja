import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAuthConfig,
  credentialsMatch,
  createSession,
  verifySession,
  SESSION_SECONDS,
} from '../lib/auth-session.ts';

// Synthetic fixtures: these values are never installed as application credentials.
const now = Date.UTC(2026, 9, 8, 12, 0, 0);
const config = {
  username: 'qa-loja',
  password: '  Senha-ficticia-para-teste-42!  ',
  secret: 'segredo-ficticio-apenas-para-testes-unitarios-42',
  operator: 'Operador de teste',
};
const environment = {
  LOJA_ADMIN_USER: config.username,
  LOJA_ADMIN_PASSWORD: config.password,
  LOJA_SESSION_SECRET: config.secret,
  LOJA_OPERATOR_NAME: config.operator,
};

test('valid credentials match and username whitespace is normalized', () => {
  assert.equal(credentialsMatch(config.username, config.password, config), true);
  assert.equal(credentialsMatch(` ${config.username} `, config.password, config), true);
});

test('incorrect credentials are rejected and password whitespace is preserved', () => {
  assert.equal(credentialsMatch('outro-usuario', config.password, config), false);
  assert.equal(credentialsMatch(config.username, 'senha-incorreta', config), false);
  assert.equal(credentialsMatch(config.username, config.password.trim(), config), false);
  assert.equal(credentialsMatch(config.username, `${config.password} `, config), false);
  assert.equal(credentialsMatch(config.username.toUpperCase(), config.password, config), false);
});

test('malformed or overlong credential inputs are rejected', () => {
  for (const username of [null, undefined, 42, {}, ['qa-loja'], 'x'.repeat(101)]) {
    assert.equal(credentialsMatch(username, config.password, config), false);
  }
  for (const password of [null, undefined, 42, {}, [], 'x'.repeat(257)]) {
    assert.equal(credentialsMatch(config.username, password, config), false);
  }
});

test('valid session identifies the configured store operator', () => {
  const token = createSession(config, now);
  assert.deepEqual(verifySession(token, config, now), {
    userId: `store:${config.username}`,
    displayName: config.operator,
  });
});

test('session expires at its exact expiry boundary', () => {
  const token = createSession(config, now);
  assert.ok(verifySession(token, config, now + SESSION_SECONDS * 1000 - 1));
  assert.equal(verifySession(token, config, now + SESSION_SECONDS * 1000), null);
  assert.equal(verifySession(token, config, now + (SESSION_SECONDS + 1) * 1000), null);
});

test('altering signed payload or signature rejects the session', () => {
  const token = createSession(config, now);
  const [payload, signature] = token.split('.');
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  parsed.sub = 'usuario-adulterado';
  const modifiedPayload = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  assert.equal(verifySession(`${modifiedPayload}.${signature}`, config, now), null);
  const first = signature[0] === 'A' ? 'B' : 'A';
  assert.equal(verifySession(`${payload}.${first}${signature.slice(1)}`, config, now), null);
});

test('malformed session tokens fail closed', () => {
  for (const token of [null, undefined, 42, {}, [], '', 'a', 'a.b', 'a.b.c', '.a', 'a.', 'a=b.c', 'a. b', 'x'.repeat(2001)]) {
    assert.equal(verifySession(token, config, now), null);
  }
});

test('future-issued sessions beyond allowed clock skew are rejected', () => {
  const token = createSession(config, now + 31000);
  assert.equal(verifySession(token, config, now), null);
});

test('changing username, password or signing secret revokes an existing session', () => {
  const token = createSession(config, now);
  assert.equal(verifySession(token, { ...config, username: 'novo-usuario' }, now), null);
  assert.equal(verifySession(token, { ...config, password: 'Nova-senha-ficticia-para-teste-43!' }, now), null);
  assert.equal(verifySession(token, { ...config, secret: 'outro-segredo-ficticio-apenas-para-teste-43' }, now), null);
});

test('changing only the operator display name keeps the session and updates its identity', () => {
  const token = createSession(config, now);
  const updated = { ...config, operator: 'Novo operador de teste' };
  assert.equal(verifySession(token, updated, now)?.displayName, updated.operator);
});

test('valid environment preserves the password and normalizes administrator username', () => {
  assert.deepEqual(readAuthConfig({ ...environment, LOJA_ADMIN_USER: ` ${config.username} ` }), config);
  assert.equal(readAuthConfig({ ...environment, LOJA_OPERATOR_NAME: '' })?.operator, 'Operador');
});

test('an explicit server minimum permits a five-character password and normal login', () => {
  const shortConfig = { ...config, username: 'qa-user', password: 'abcde' };
  const configured = readAuthConfig({
    ...environment,
    LOJA_ADMIN_USER: shortConfig.username,
    LOJA_ADMIN_PASSWORD: shortConfig.password,
    LOJA_ADMIN_MIN_PASSWORD_LENGTH: '5',
  });
  assert.deepEqual(configured, shortConfig);
  assert.equal(credentialsMatch(shortConfig.username, shortConfig.password, configured), true);
  assert.equal(credentialsMatch(shortConfig.username, 'abcdf', configured), false);
  assert.equal(verifySession(createSession(configured, now), configured, now)?.userId, 'store:qa-user');
});

test('the default password minimum remains twelve characters', () => {
  for (const length of [5, 8, 11]) {
    assert.equal(readAuthConfig({ ...environment, LOJA_ADMIN_PASSWORD: 'x'.repeat(length) }), null);
  }
  assert.equal(readAuthConfig({ ...environment, LOJA_ADMIN_PASSWORD: 'x'.repeat(12) })?.password, 'x'.repeat(12));
});

test('invalid server minimum configuration fails closed even for a long password', () => {
  for (const minimum of ['NaN', '4', '257', '1.5']) {
    assert.equal(readAuthConfig({ ...environment, LOJA_ADMIN_MIN_PASSWORD_LENGTH: minimum }), null);
  }
});

test('empty passwords and passwords below the configured minimum are rejected', () => {
  for (const password of ['', 'abcd']) {
    assert.equal(readAuthConfig({
      ...environment,
      LOJA_ADMIN_PASSWORD: password,
      LOJA_ADMIN_MIN_PASSWORD_LENGTH: '5',
    }), null);
  }
  assert.equal(readAuthConfig({
    ...environment,
    LOJA_ADMIN_PASSWORD: 'abcde',
    LOJA_ADMIN_MIN_PASSWORD_LENGTH: '6',
  }), null);
});

test('the maximum allowed minimum accepts exactly 256 password characters', () => {
  const longest = 'x'.repeat(256);
  assert.equal(readAuthConfig({
    ...environment,
    LOJA_ADMIN_PASSWORD: longest,
    LOJA_ADMIN_MIN_PASSWORD_LENGTH: '256',
  })?.password, longest);
  assert.equal(readAuthConfig({
    ...environment,
    LOJA_ADMIN_PASSWORD: `${longest}x`,
    LOJA_ADMIN_MIN_PASSWORD_LENGTH: '256',
  }), null);
});

test('changing a short-password account still revokes its existing sessions', () => {
  const shortConfig = { ...config, username: 'qa-user', password: 'abcde' };
  const token = createSession(shortConfig, now);
  assert.equal(verifySession(token, { ...shortConfig, username: 'qa-other' }, now), null);
  assert.equal(verifySession(token, { ...shortConfig, password: 'fghij' }, now), null);
});

test('missing or invalid authentication configuration is rejected', () => {
  const invalid = [
    {},
    { ...environment, LOJA_ADMIN_USER: undefined },
    { ...environment, LOJA_ADMIN_USER: '   ' },
    { ...environment, LOJA_ADMIN_USER: 'x'.repeat(101) },
    { ...environment, LOJA_ADMIN_PASSWORD: undefined },
    { ...environment, LOJA_ADMIN_PASSWORD: 'x'.repeat(11) },
    { ...environment, LOJA_ADMIN_PASSWORD: 'x'.repeat(257) },
    { ...environment, LOJA_SESSION_SECRET: undefined },
    { ...environment, LOJA_SESSION_SECRET: 'x'.repeat(31) },
  ];
  for (const env of invalid) assert.equal(readAuthConfig(env), null);
});

test('session payload contains no administrator password or signing secret', () => {
  const token = createSession(config, now);
  const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  const parsed = JSON.parse(payload);
  assert.equal(parsed.sub, config.username);
  assert.equal(Object.hasOwn(parsed, 'password'), false);
  assert.equal(Object.hasOwn(parsed, 'secret'), false);
  assert.equal(payload.includes(config.password), false);
  assert.equal(payload.includes(config.secret), false);
  assert.equal(token.includes(config.password), false);
  assert.equal(token.includes(config.secret), false);
});
