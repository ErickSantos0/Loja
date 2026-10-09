# Fio Caixa para Windows

Aplicativo local em React e Electron, com SQLite. Funciona sem internet e sem instalar Node.js no computador da loja. Destinado a Windows 10/11 de 64 bits.

## Instalar e usar

1. Execute `Fio-Caixa-1.0.0-Instalador.exe` e siga o assistente. A instalação é feita para o usuário atual do Windows, com atalhos na Área de Trabalho e no menu Iniciar.
2. Abra **Fio Caixa**, informe o nome do operador e configure a loja em **Configurações**.
3. Cadastre roupas em **Estoque**, abra o caixa e comece a vender. Leitores USB devem funcionar como teclado HID e enviar **Enter** após o código. **F2** foca o leitor e **F9** abre o pagamento.
4. No menu **Arquivos e backup**, salve uma cópia completa em um pendrive ou em outro computador regularmente.

`Fio-Caixa-1.0.0-Portatil.exe` abre o mesmo aplicativo sem instalação. A primeira abertura pode demorar enquanto o Windows extrai os arquivos. Seus dados são mantidos no perfil do usuário do Windows; mover apenas o executável não transfere a loja.

Os pacotes não têm assinatura digital de uma empresa. O Windows pode mostrar o editor como desconhecido.

## Dados, backup e mudança de computador

O banco fica em `%APPDATA%\Fio Caixa\data\fio-caixa.sqlite3`. O aplicativo mostra o caminho com **Arquivos e backup → Abrir pasta dos dados**. Cada usuário do Windows tem sua própria loja local. A versão instalada e a portátil usam o mesmo banco quando executadas pelo mesmo usuário.

**Salvar backup completo** produz um snapshot SQLite consistente com vendas, estoque, clientes, parcelas, caixa e histórico de confirmações. Salve-o fora da pasta interna do aplicativo. Para mudar de computador, instale o Fio no computador novo e use **Restaurar backup**. Essa ação pede confirmação e substitui os dados atuais. Antes da substituição, o Fio guarda automaticamente uma cópia dos dados anteriores em `data\backups`.

Para trazer dados da versão web, use **Configurações → Exportar todos os dados** no sistema web e depois **Arquivos e backup → Importar dados da versão web** no aplicativo. A importação é uma transferência única e substitui a base local após confirmação. A versão web e o aplicativo não sincronizam vendas entre si. Não opere simultaneamente a mesma loja nas duas bases esperando que o estoque seja compartilhado.

Fechar o aplicativo não apaga o banco. A desinstalação preserva a pasta de dados. Mantenha backups externos, pois a falha do computador pode afetar tanto o banco quanto as cópias guardadas nele.

## Operação da loja

O caixa oferece pagamentos mistos, troco em dinheiro, descontos, cartão em até 12 parcelas, crediário com recebimentos, devoluções, sangria e suprimento, fechamento, clientes e relatórios. Cartão e Pix são registrados manualmente; confira a aprovação na maquininha ou no banco. O comprovante impresso é não fiscal. Integrações com TEF e emissão de NFC-e/NF-e não estão incluídas.

O nome do operador identifica os registros; ele pode ser alterado na barra superior e não é uma senha de acesso. O acesso físico ao computador e à conta do Windows controla quem pode abrir a loja.

Se uma operação ficar sem confirmação, use a indicação de **operação pendente** antes de continuar. A mesma operação é conferida pelo seu identificador para impedir duplicação, inclusive depois de fechar o programa. Uma falha em venda ou estoque desfaz a transação inteira.

## Compilar

Na raiz do projeto, instale as dependências do sistema e do aplicativo:

```powershell
npm ci
npm --prefix desktop ci
npm --prefix desktop run check
npm --prefix desktop test
npm --prefix desktop run package
```

O comando gera os dois executáveis em `desktop/release`. O ícone já acompanha o projeto; para regenerá-lo no Windows: `powershell -File desktop/assets/create-icon.ps1`.

Arquitetura: renderer estático em React reutiliza `app/pos-app.tsx`; preload expõe métodos específicos por IPC; main controla SQLite e diálogos. Renderer sem Node, com sandbox, isolamento de contexto, CSP e bloqueio de acessos de rede. Banco e operador ficam fora do pacote ASAR. Electron 44.5.1 e electron-builder 26.15.3 estão fixados no lockfile. [Segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [empacotamento NSIS](https://www.electron.build/v26/docs/nsis/).

Os testes de interface usam a flag `--fio-test-data-dir=<caminho-absoluto>`: uma janela oculta e uma pasta separada, sem alterar a loja do usuário. O teste executa o aplicativo empacotado com internet desativada.

Para repetir os testes do executável, instale o Playwright usado na validação e execute os scripts após empacotar. Eles não exigem instalar outro navegador, pois usam o Electron do aplicativo:

```powershell
npm install --prefix desktop --no-save playwright@1.63.0
node desktop/tests/smoke.mjs
node desktop/tests/portable-smoke.mjs
```
