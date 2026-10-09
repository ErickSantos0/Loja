import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
const { chromium } = await import('playwright').catch(() => import('../../.sites-runtime/qa/node_modules/playwright/index.mjs'));

// NSIS does not reliably relay the child's inspector stderr. Attach to
// Chromium using the port file in the isolated QA profile instead.
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..');
const { version } = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const executablePath = resolve(process.argv.slice(2).find((argument) => !argument.startsWith('--')) || join(desktopRoot, 'release', `Fio-Caixa-${version}-Portatil.exe`));
await access(executablePath);
const artifacts = join(projectRoot, '.qa');
const previous = process.argv.includes('--verify-existing')
  ? JSON.parse(await readFile(join(artifacts, 'desktop-portable-failure.json'), 'utf8'))
  : null;
if (previous) {
  assert.match(previous.error, /page\.screenshot/);
  assert.ok(previous.checks.length >= 3);
  const target = relative(join(artifacts, 'test-run'), previous.dataDir);
  assert.ok(target.startsWith('portable-') && !target.includes('..') && !isAbsolute(target));
  assert.deepEqual(previous.errors, []);
  assert.deepEqual(previous.requests, []);
  assert.deepEqual(previous.failedAssets, []);
}
const dataDir = previous?.dataDir || join(artifacts, 'test-run', `portable-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const portFile = join(dataDir, 'DevToolsActivePort');
const errors = [];
const requests = [];
const failedAssets = [];
const checks = [];
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.NODE_OPTIONS;
let portableProcess;
let browser;
let page;
let processError;
let processLogs = '';
let persisted;

async function until(read, test, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    if (processError) throw processError;
    value = await read();
    if (test(value)) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Tempo limite excedido: ${JSON.stringify(value)}\n${processLogs}`);
}

async function start() {
  await unlink(portFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  processError = undefined;
  console.log('Iniciando o executável portátil com dados de QA e janela oculta.');
  portableProcess = spawn(executablePath, [
    '/S', `--fio-test-data-dir=${dataDir}`, '--remote-debugging-port=0',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ], { cwd: projectRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  portableProcess.on('error', (error) => { processError = error; });
  const log = (chunk) => { processLogs = (processLogs + String(chunk)).slice(-20000); };
  portableProcess.stdout.on('data', log);
  portableProcess.stderr.on('data', log);
  const debugPort = await until(async () => {
    if (portableProcess.exitCode !== null) throw new Error(`Portátil encerrou antes de abrir: ${portableProcess.exitCode}\n${processLogs}`);
    try { return (await readFile(portFile, 'utf8')).trim().split(/\r?\n/); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }, (lines) => /^\d+$/.test(lines[0] || '') && !!lines[1], 90000);
  browser = await chromium.connectOverCDP(`ws://127.0.0.1:${debugPort[0]}${debugPort[1]}`);
  const context = browser.contexts()[0];
  assert.ok(context);
  await context.setOffline(true);
  page = context.pages()[0] || await context.waitForEvent('page');
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
  page.on('requestfailed', (request) => { if (request.url().startsWith('file:')) failedAssets.push(request.url()); });
  await page.getByRole('heading', { name: 'Frente de caixa', exact: true, includeHidden: true }).waitFor();
  assert.ok(page.url().startsWith('file:'));
  assert.ok(page.url().includes('app.asar'), 'O portátil deve abrir seus próprios arquivos empacotados.');
  const info = await page.evaluate(() => window.fioDesktop.getInfo());
  const pathFromQA = relative(dataDir, info.databasePath);
  assert.ok(pathFromQA && !pathFromQA.startsWith('..') && !isAbsolute(pathFromQA), `Banco fora da pasta QA: ${info.databasePath}`);
  return info;
}

async function stop() {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  browser = undefined;
  page = undefined;
  if (portableProcess && portableProcess.exitCode === null) {
    await until(async () => portableProcess.exitCode, (exit) => exit !== null, 30000);
  }
  assert.equal(portableProcess?.exitCode, 0, `Código de saída do portátil: ${portableProcess?.exitCode}\n${processLogs}`);
}

try {
  if (!previous) {
  await start();
  await page.getByLabel('Nome do operador', { exact: true }).fill('Portátil QA');
  await page.getByRole('button', { name: 'Salvar nome', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const seeded = await page.evaluate(async () => {
    const created = await window.fioDesktop.mutate({
      action: 'product.save', requestId: crypto.randomUUID(),
      input: { name: 'Camiseta Portátil QA', barcode: '0000004321', category: 'Camisetas', size: 'G', color: 'Verde', price: 1999, cost: 900, stock: 5, minimum: 1 },
    });
    const opened = await window.fioDesktop.mutate({ action: 'cash.open', input: { opening: 10000 }, requestId: crypto.randomUUID() });
    return { created, opened };
  });
  assert.equal(seeded.created.state.products[0].stock, 5);
  assert.equal(seeded.opened.state.sessions[0].operator, 'Portátil QA');
  await page.getByRole('button', { name: 'Atualizar dados', exact: true }).click();
  await page.getByText('5 em estoque', { exact: true }).waitFor();
  checks.push('portátil extrai o próprio pacote e abre caixa/SQLite local sem servidor');

  const scanner = page.getByLabel('Ler código de barras', { exact: true });
  for (let i = 0; i < 2; i++) {
    await scanner.fill('');
    await scanner.pressSequentially('0000004321');
    await scanner.press('Enter');
  }
  assert.equal(await page.locator('.count').innerText(), '2');
  assert.match(await page.locator('.total-row').innerText(), /39,98/);
  await page.keyboard.press('F9');
  await page.getByRole('dialog').getByLabel('Valor (R$)', { exact: true }).fill('50,00');
  assert.match(await page.getByRole('dialog').innerText(), /10,02/);
  await page.getByRole('button', { name: 'Confirmar recebimento e finalizar venda', exact: true }).click();
  await page.locator('.receipt').waitFor();
  persisted = await page.evaluate(() => window.fioDesktop.loadState());
  assert.equal(persisted.sales.length, 1);
  assert.equal(persisted.sales[0].total, 3998);
  assert.equal(persisted.sales[0].change, 1002);
  assert.equal(persisted.products[0].stock, 3);
  assert.equal(persisted.sales[0].operator, 'Portátil QA');
  assert.equal(await page.evaluate(() => window.fioDesktop.pending.get()), null);
  checks.push('leitor com zeros e Enter, quantidade repetida, venda com troco e baixa do estoque');
  await stop();
  checks.push('encerramento fecha o aplicativo e o inicializador portátil com código 0');
  } else {
    checks.push(...previous.checks);
  }

  const info = await start();
  assert.equal(info.operator, 'Portátil QA');
  const stored = await page.evaluate(() => window.fioDesktop.loadState());
  if (!previous) assert.deepEqual(stored, persisted);
  assert.equal(stored.sales.length, 1);
  assert.equal(stored.sales[0].total, 3998);
  assert.equal(stored.sales[0].change, 1002);
  assert.equal(stored.products[0].stock, 3);
  assert.equal(stored.sales[0].operator, 'Portátil QA');
  persisted = stored;
  assert.equal(await page.getByRole('dialog').count(), 0);
  checks.push('nova extração/reabertura preserva operador, venda, estoque e caixa');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert.deepEqual(failedAssets, []);
  checks.push('funciona offline sem solicitações HTTP nem falhas de assets');
  await stop();
  const result = { ok: true, executablePath, dataDir, verifiedExisting: !!previous, checks, sales: persisted.sales.length, stock: persisted.products[0].stock, errors, requests, failedAssets };
  await writeFile(join(artifacts, 'desktop-portable-smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(artifacts, 'desktop-portable-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(artifacts, 'desktop-portable-failure.json'), JSON.stringify({ error: String(error), checks, errors, requests, failedAssets, dataDir, processLogs }, null, 2));
  throw error;
} finally {
  await stop().catch(() => { if (portableProcess?.exitCode === null) portableProcess.kill(); });
}
