import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
const { _electron: electron } = await import('playwright').catch(() => import('../../.sites-runtime/qa/node_modules/playwright/index.mjs'));

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultExecutable = join(projectRoot, 'desktop/release/win-unpacked/FioCaixa.exe');

async function eventually(read, expected, timeout = 10000) {
  const until = Date.now() + timeout;
  let actual;
  do {
    actual = await read();
    if (actual === expected) return;
    await new Promise((done) => setTimeout(done, 75));
  } while (Date.now() < until);
  assert.equal(actual, expected);
}

function insideDirectory(path, directory) {
  const rel = relative(directory, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function runSmoke(executablePath = defaultExecutable, label = 'unpacked') {
  executablePath = resolve(executablePath);
  await access(executablePath);
  const artifacts = join(projectRoot, '.qa');
  const dataDir = join(artifacts, 'test-run', `${label}-${Date.now()}`);
  const backupPath = join(dataDir, 'backup-caixa.sqlite3');
  await mkdir(dataDir, { recursive: true });
  const errors = [];
  const failedAssets = [];
  const networkRequests = [];
  const captureWarnings = [];
  const checks = [];
  let application;
  let page;
  let persisted;

  async function start() {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    application = await electron.launch({
      executablePath,
      args: [`--fio-test-data-dir=${dataDir}`],
      cwd: projectRoot,
      env: environment,
      timeout: 45000,
    });
    await application.context().setOffline(true);
    page = await application.firstWindow({ timeout: 30000 });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    });
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
    });
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('file:')) failedAssets.push({ url: request.url(), error: request.failure()?.errorText });
    });
    // The optional operator dialog makes the background aria-hidden on first launch.
    await page.getByRole('heading', { name: 'Frente de caixa', exact: true, includeHidden: true }).waitFor();
    assert.ok(page.url().startsWith('file:'), `Aplicativo carregado por ${page.url()}`);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible())), false,
      'A janela de QA deve permanecer oculta.');
    const info = await page.evaluate(() => window.fioDesktop.getInfo());
    assert.ok(insideDirectory(info.databasePath, dataDir), `Banco fora do diretório de QA: ${info.databasePath}`);
    return info;
  }

  const state = () => page.evaluate(() => window.fioDesktop.loadState());
  const hideDialog = () => page.getByRole('dialog').waitFor({ state: 'hidden' });
  async function scan(count = 1) {
    const input = page.getByLabel('Ler código de barras', { exact: true });
    for (let i = 0; i < count; i++) {
      await input.fill('');
      await input.pressSequentially('00001234567890');
      await input.press('Enter');
    }
  }
  async function checkout() {
    await page.keyboard.press('F9');
    await page.getByRole('dialog').getByText('Total a receber', { exact: true }).waitFor();
    return page.getByRole('dialog');
  }
  async function confirmSale() {
    await page.getByRole('button', { name: 'Confirmar recebimento e finalizar venda', exact: true }).click();
    await page.locator('.receipt').waitFor();
  }

  try {
    await start();
    await page.getByLabel('Nome do operador', { exact: true }).fill('Operador QA');
    await page.getByRole('button', { name: 'Salvar nome', exact: true }).click();
    await hideDialog();
    assert.equal((await page.evaluate(() => window.fioDesktop.getInfo())).operator, 'Operador QA');
    assert.equal((await state()).sales.length, 0);
    checks.push('janela oculta, banco isolado e execução file:// offline');

    await page.getByRole('button', { name: 'Cadastrar primeira peça', exact: true }).click();
    await page.getByLabel('Nome da peça', { exact: true }).fill('Camiseta QA');
    await page.getByLabel('Código de barras', { exact: true }).fill('00001234567890');
    await page.getByLabel('Categoria', { exact: true }).fill('Camisetas');
    await page.getByLabel('Tamanho', { exact: true }).fill('M');
    await page.getByLabel('Cor', { exact: true }).fill('Preta');
    await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('19,99');
    await page.getByLabel('Custo de compra (R$)', { exact: true }).fill('10,50');
    await page.getByLabel('Estoque inicial', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Salvar peça', exact: true }).click();
    await hideDialog();
    assert.equal((await state()).products[0].barcode, '00001234567890');
    checks.push('cadastro de roupa com tamanho, cor, estoque e zeros no código');

    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await page.getByLabel('Fundo inicial em dinheiro (R$)', { exact: true }).fill('100,00');
    await page.getByRole('dialog').getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await hideDialog();
    await scan(3);
    assert.equal(await page.locator('.count').innerText(), '3');
    await page.locator('.sale-panel').getByRole('combobox', { name: 'Desconto', exact: true }).click();
    await page.getByRole('option', { name: 'Percentual (%)', exact: true }).click();
    await page.locator('.sale-panel').getByLabel('Valor', { exact: true }).fill('10');
    assert.match(await page.locator('.total-row').innerText(), /53,97/);
    let dialog = await checkout();
    await dialog.getByLabel('Valor (R$)', { exact: true }).fill('100,00');
    assert.match(await dialog.innerText(), /46,03/);
    await confirmSale();
    let saved = await state();
    assert.equal(saved.sales[0].total, 5397);
    assert.equal(saved.sales[0].change, 4603);
    assert.equal(saved.products[0].stock, 9);
    assert.equal(saved.sales[0].operator, 'Operador QA');
    checks.push('leitor por teclado + Enter, quantidade repetida, desconto, troco e baixa do estoque');

    await page.screenshot({ path: join(artifacts, `desktop-${label}-receipt.png`), fullPage: true });
    await application.evaluate(({ BrowserWindow }) => {
      globalThis.__fioQaPrintCalls = 0;
      BrowserWindow.getAllWindows()[0].webContents.print = (_options, callback) => {
        globalThis.__fioQaPrintCalls++;
        callback(true);
      };
    });
    await page.getByRole('button', { name: 'Imprimir comprovante', exact: true }).click();
    await eventually(() => application.evaluate(() => globalThis.__fioQaPrintCalls), 1);
    const pdf = await application.evaluate(async ({ BrowserWindow }) => Array.from(await BrowserWindow.getAllWindows()[0].webContents.printToPDF({
      printBackground: true,
      pageSize: { width: 80 / 25.4, height: 300 / 25.4 },
      margins: { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 },
    })));
    assert.ok(pdf.length > 1000);
    await writeFile(join(artifacts, `desktop-${label}-receipt.pdf`), Buffer.from(pdf));
    await page.keyboard.press('Escape');
    checks.push('botão de impressão chama API nativa e comprovante gera PDF');

    await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
    await page.getByLabel('Nome do cliente', { exact: true }).fill('Cliente QA');
    await page.getByLabel('Telefone', { exact: true }).fill('11999990000');
    await page.getByRole('button', { name: 'Salvar cliente', exact: true }).click();
    await hideDialog();
    await page.getByRole('button', { name: 'Frente de caixa', exact: true }).click();
    await page.locator('.sale-panel').getByRole('combobox', { name: 'Cliente', exact: true }).click();
    await page.getByRole('option', { name: 'Cliente QA', exact: true }).click();
    await scan(2);
    dialog = await checkout();
    await dialog.getByLabel('Valor (R$)', { exact: true }).fill('10,00');
    await page.getByRole('button', { name: 'Dividir entre formas de pagamento', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Forma de pagamento', exact: true }).nth(1).click();
    await page.getByRole('option', { name: 'Crediário', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Parcelas sem juros', exact: true }).click();
    await page.getByRole('option', { name: '3x', exact: true }).click();
    await confirmSale();
    saved = await state();
    const secondSale = saved.sales.at(-1);
    assert.equal(secondSale.total, 3998);
    assert.deepEqual(saved.receivables.filter((row) => row.saleId === secondSale.id).map((row) => row.amount), [1000, 999, 999]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Crediário', exact: true }).click();
    await page.getByRole('button', { name: 'Receber', exact: true }).first().click();
    await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('3,00');
    await page.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
    await hideDialog();
    assert.equal((await state()).receivables.find((row) => row.saleId === secondSale.id && row.number === 1).paid, 300);
    checks.push('cliente, pagamento misto, crediário em 3 parcelas exatas e recebimento parcial');

    await page.getByRole('button', { name: 'Frente de caixa', exact: true }).click();
    await scan();
    dialog = await checkout();
    await dialog.getByRole('combobox', { name: 'Forma de pagamento', exact: true }).click();
    await page.getByRole('option', { name: 'Crédito', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Parcelas sem juros', exact: true }).click();
    await page.getByRole('option', { name: '3x', exact: true }).click();
    await confirmSale();
    saved = await state();
    assert.equal(saved.sales.at(-1).payments[0].method, 'credit');
    assert.equal(saved.sales.at(-1).payments[0].installments, 3);
    assert.equal(saved.products[0].stock, 6);
    await page.keyboard.press('Escape');
    checks.push('venda no cartão parcelado em 3x');

    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, backupPath);
    await page.getByRole('button', { name: 'Arquivos e backup', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Salvar backup completo', exact: true }).click();
    await eventually(async () => {
      try { return (await readFile(backupPath)).subarray(0, 16).toString(); }
      catch { return ''; }
    }, 'SQLite format 3\u0000');
    assert.equal(await page.evaluate(() => window.fioDesktop.pending.get()), null);
    persisted = await state();
    await page.screenshot({ path: join(artifacts, `desktop-${label}-pos.png`), fullPage: true });
    checks.push('backup completo SQLite por diálogo nativo (mock de escolha de arquivo)');

    await application.close();
    application = null;
    const restoredInfo = await start();
    assert.equal(restoredInfo.operator, 'Operador QA');
    assert.deepEqual(await state(), persisted);
    assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push('reinício preserva operador, vendas, parcelas, abertura de caixa e estoque');

    // Change the isolated QA database after the backup, then exercise both native choices.
    const changed = await page.evaluate(() => window.fioDesktop.mutate({
      action: 'product.save',
      input: { name: 'Depois do backup', barcode: 'QA-AFTER-BACKUP', category: 'QA', size: 'P', color: 'Azul', price: 1000, cost: 500, stock: 2, minimum: 0 },
      requestId: crypto.randomUUID(),
    }));
    assert.equal(changed.state.products.length, 2);
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, backupPath);
    assert.equal((await page.evaluate(() => window.fioDesktop.restoreBackup())).cancelled, true);
    assert.deepEqual(await state(), changed.state);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    // Attach the rejection immediately so slower hidden-window clicks cannot
    // produce an unhandled rejection before this promise is awaited.
    const reload = page.waitForEvent('load', { timeout: 30000 }).then(() => null, (error) => error);
    await page.getByRole('button', { name: 'Arquivos e backup', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Restaurar backup…', exact: true }).click();
    const reloadError = await reload;
    if (reloadError) throw reloadError;
    await page.getByRole('heading', { name: 'Frente de caixa', exact: true }).waitFor();
    assert.deepEqual(await state(), persisted);
    checks.push('restauração cancelada preserva alterações; confirmação restaura backup completo');

    // Model closing between a committed operation and receipt of its confirmation.
    const recovery = await page.evaluate(async () => {
      const operation = { action: 'customer.save', input: { name: 'Cliente Recuperação QA', phone: '', email: '', document: '' }, requestId: crypto.randomUUID() };
      await window.fioDesktop.pending.set(JSON.stringify(operation));
      return window.fioDesktop.mutate(operation);
    });
    persisted = recovery.state;
    assert.equal(persisted.customers.filter((customer) => customer.name === 'Cliente Recuperação QA').length, 1);
    await application.close();
    application = null;
    await start();
    await page.getByRole('button', { name: 'Conferir operação', exact: true }).click();
    await eventually(() => page.evaluate(() => window.fioDesktop.pending.get()), null);
    assert.deepEqual(await state(), persisted);
    assert.equal((await state()).customers.filter((customer) => customer.name === 'Cliente Recuperação QA').length, 1);
    checks.push('operação pendente sobrevive ao encerramento e reenvio não duplica registros');

    await page.getByRole('button', { name: 'Estoque', exact: true }).click();
    await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor();
    assert.match(await page.locator('table').innerText(), /00001234567890/);
    await page.getByRole('button', { name: 'Frente de caixa', exact: true }).click();
    const unknownBarcode = page.getByLabel('Ler código de barras', { exact: true });
    await unknownBarcode.fill('QA-CODIGO-DESCONHECIDO');
    await unknownBarcode.press('Enter');
    assert.equal(await page.locator('.count').innerText(), '0');
    assert.deepEqual(await state(), persisted);
    checks.push('código desconhecido preserva venda e estoque');

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 650));
    const sidebar = page.locator('[data-slot="sidebar-container"]');
    const viewportHeight = await page.evaluate(() => innerHeight);
    for (const name of ['Frente de caixa', 'Estoque', 'Vendas', 'Clientes', 'Crediário', 'Controle de caixa', 'Relatórios', 'Configurações', 'Ajuda e atalhos']) {
      const button = sidebar.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.y >= 40 && bounds.y + bounds.height <= viewportHeight + 1,
        `Menu ${name} não cabe nem fica acessível ao rolar em ${viewportHeight}px: ${JSON.stringify(bounds)}`);
    }
    try {
      await page.screenshot({ path: join(artifacts, `desktop-${label}-compact.png`), timeout: 30000 });
    } catch (error) {
      captureWarnings.push(`Captura compacta da janela oculta: ${String(error)}`);
    }
    checks.push('todos os menus ficam acessíveis em janela de 650px, com rolagem se necessário');

    assert.deepEqual(errors, []);
    assert.deepEqual(failedAssets, []);
    assert.deepEqual(networkRequests, []);
    const result = { ok: true, executablePath, dataDir, checks, sales: persisted.sales.length, stock: persisted.products[0].stock, errors, failedAssets, networkRequests, captureWarnings };
    await writeFile(join(artifacts, `desktop-${label}-smoke.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(artifacts, `desktop-${label}-failure.png`), fullPage: true }).catch(() => {});
      await writeFile(join(artifacts, `desktop-${label}-failure.html`), await page.content()).catch(() => {});
    }
    await writeFile(join(artifacts, `desktop-${label}-failure.json`), JSON.stringify({ error: String(error), checks, errors, failedAssets, networkRequests, dataDir }, null, 2));
    throw error;
  } finally {
    if (application) await application.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runSmoke(process.argv[2] || process.env.FIO_TEST_EXE || defaultExecutable);
}
