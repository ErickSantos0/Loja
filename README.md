# Fio — caixa e estoque para loja de roupas

Aplicação em React, TypeScript e Next.js 16, com login próprio e banco PostgreSQL persistente. Na versão web, os dispositivos conectados ao mesmo banco compartilham vendas e estoque; o acesso exige conexão com o servidor. O projeto também inclui um aplicativo independente para Windows, com banco SQLite local e funcionamento sem internet.

## Usar na loja

Na versão web, entre com o usuário e a senha configurados pelo responsável pela loja. No Windows, abra **Fio Caixa** e informe o nome do operador. O instalador e a versão portátil são gerados em `desktop/release`. Consulte [as instruções do aplicativo](desktop/README.md) para instalar, fazer backup ou importar os dados da versão web.

O aplicativo Windows e a versão web mantêm bancos separados. A importação da exportação JSON da web para o aplicativo é uma transferência única; não há sincronização automática entre eles.

Baixe o [instalador Windows](https://github.com/ErickSantos0/Loja/releases/download/v1.0.0/Fio-Caixa-1.0.0-Instalador.exe) ou a [versão portátil](https://github.com/ErickSantos0/Loja/releases/download/v1.0.0/Fio-Caixa-1.0.0-Portatil.exe). As instruções e os hashes SHA256 estão na [release v1.0.0](https://github.com/ErickSantos0/Loja/releases/tag/v1.0.0).

1. Abra **Configurações** e preencha o nome e contato da loja.
2. Em **Estoque**, cadastre uma peça para cada combinação de tamanho e cor, com código de barras exclusivo, custo, preço e quantidade inicial. Zeros à esquerda do código são preservados.
3. **Abra o caixa** e informe o fundo inicial em dinheiro.
4. Na **Frente de caixa**, pressione **F2**, leia as etiquetas, confira quantidades e desconto e pressione **F9** para receber.
5. Escolha dinheiro, Pix, débito, crédito em até 12 parcelas sem juros ou crediário. É possível dividir entre meios de pagamento. O troco é calculado apenas para dinheiro.
6. Confira a aprovação no equipamento/banco e confirme o recebimento no sistema. Imprima o comprovante se desejar.
7. No final do expediente, registre sangrias/suprimentos e **feche o caixa**, informando o dinheiro contado.

## Funcionalidades

- Caixa: soma, alteração de quantidades, remoção de itens, desconto em reais ou percentual, pagamentos mistos, troco, parcelas com divisão exata de centavos e comprovante não fiscal.
- Estoque: cadastro/edição de roupas, categoria, tamanho, cor, código de barras, preço/custo, estoque mínimo, peças inativas, entrada/saída com motivo e histórico de movimentações.
- Vendas: histórico, reimpressão, cancelamento/devolução integral e devolução parcial, com opção de repor cada peça ao estoque. Para uma troca, registre a devolução e faça a nova venda.
- Clientes e crediário: cadastro, vencimentos mensais, parcelas em atraso, recebimento total/parcial e saldo por cliente. Vendas com crediário permitem devolução integral; a dívida em aberto é cancelada e valores já recebidos são reembolsados.
- Controle de caixa: fundo inicial, suprimento, sangria, entradas separadas por meio, saldo físico esperado, contado, diferença e histórico de fechamentos.
- Relatórios: período, vendas, devoluções, ticket médio, peças vendidas e pagamentos; CSV de vendas/estoque e exportação completa JSON.
- Segurança operacional: validação no servidor, cálculos em centavos, transação de venda/estoque/pagamento, controle de concorrência, idempotência e recuperação de operação pendente após falha de conexão e recarregamento da aba.

## Leitor de códigos de barras

Compatível com leitores USB configurados como **teclado HID**, com sufixo **Enter**. Conecte o leitor, pressione F2 ou clique no campo **Ler código de barras** e leia uma etiqueta cadastrada. A mesma etiqueta lida duas vezes adiciona duas unidades, respeitando o estoque disponível.

Configure o leitor conforme o manual do fabricante. Para testar o modo teclado, uma leitura no Bloco de Notas deve escrever o código e finalizar com Enter. Não há captura global de texto: ao editar cadastros, o leitor escreve no campo focado. No cadastro da peça, Enter no campo do código não salva o formulário automaticamente.

A validação foi feita com digitação e Enter simulando um leitor. A verificação com o equipamento físico deve ser realizada na loja. Leitores que exigem porta serial, SDK próprio ou Bluetooth sem modo teclado precisam de adaptador específico.

## Pagamentos e impressão

Cartão e Pix são **registros manuais**. Esta versão não cobra cartão, não confirma Pix automaticamente, não gera cobrança bancária e não integra TEF/maquininha. Confira a aprovação e eventuais estornos nos equipamentos antes de confirmar os registros. O parcelamento de crédito é informativo; o crediário controla os recebimentos da loja.

O comprovante é **não fiscal**. Emissão de NFC-e/NF-e e integrações de pagamento precisam de serviços externos, configuração e credenciais próprios. A impressão usa o diálogo do navegador, compatível com impressora comum ou térmica; selecione o equipamento e papel adequado. O layout foi verificado em PDF de 80 mm.

## Desenvolvimento local

Requer Node.js 24 recomendado (mínimo declarado no projeto: 22.13), npm e navegador atual.

```powershell
npm ci
Copy-Item .env.example .env.local
```

Edite `.env.local` antes de iniciar o servidor:

| Variável | Configuração |
| --- | --- |
| `DATABASE_URL` | Conexão de um banco PostgreSQL local ou externo. Na Vercel, prefira a conexão com pooler fornecida pelo Neon ou pelo seu provedor. |
| `LOJA_ADMIN_USER` | Nome do usuário de acesso à loja. |
| `LOJA_ADMIN_PASSWORD` | Senha exclusiva com no mínimo 12 caracteres. |
| `LOJA_SESSION_SECRET` | Segredo aleatório de pelo menos 32 caracteres, usado para assinar as sessões. |
| `LOJA_OPERATOR_NAME` | Nome do operador que aparece nos registros; se omitido, será usado `Operador`. |

O arquivo de exemplo não contém uma senha ou um segredo de sessão válidos. Gere um segredo e copie o resultado para `LOJA_SESSION_SECRET`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Não publique `.env.local` nem suas credenciais no GitHub. A autenticação recusa configurações sem senha e segredo válidos; não existe uma senha padrão de produção. As sessões duram 12 horas e são invalidadas quando o usuário, a senha ou o segredo são alterados.

```powershell
npm run dev
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173) e faça login. O banco PostgreSQL deve existir e permitir a criação das tabelas. O servidor cria automaticamente `fio_records`, `fio_revision` e a configuração inicial da loja na primeira utilização; o estoque começa vazio. Não é necessário executar Wrangler ou entrar com uma conta ChatGPT.

Para verificar e executar a compilação de produção:

```powershell
npm run check
npm test
npm run build
npm start
```

`npm start` também usa a porta 5173 e exige uma compilação concluída. Use um banco separado para desenvolvimento e testes, sem apontar operações de teste para a loja em produção.

## Publicar na Vercel

O repositório do projeto é [ErickSantos0/Loja](https://github.com/ErickSantos0/Loja). Importe esse repositório na Vercel com o preset **Next.js** e a raiz do repositório como diretório do projeto. `vercel.json` define `npm ci` como instalação e `npm run build` como compilação.

1. Crie ou conecte um banco PostgreSQL persistente, por exemplo Neon, e obtenha sua URL de conexão com pooler.
2. Configure as cinco variáveis da tabela acima em **Settings → Environment Variables**. Esses valores são usados somente no servidor; não use o prefixo `NEXT_PUBLIC_`.
3. Publique o projeto e abra o endereço fornecido pela Vercel. Entre com o usuário e a senha definidos para a loja.
4. Ao alterar as variáveis de ambiente, faça uma nova publicação para que o servidor use os novos valores.

O PostgreSQL é obrigatório para armazenar os dados da versão web. O aplicativo não grava vendas em arquivos locais das funções da Vercel. Configure um banco próprio para publicações de preview quando for testar alterações e mantenha backups do banco de produção no provedor, além da exportação JSON disponível no sistema.

## Compilar o aplicativo Windows

```powershell
npm ci
npm --prefix desktop ci
npm --prefix desktop run check
npm --prefix desktop test
npm --prefix desktop run package
```

Os executáveis de instalação e portátil ficam em `desktop/release`. Depois de instalado, o aplicativo da loja não exige Node.js, PostgreSQL ou conexão com a Vercel. [O guia do Windows](desktop/README.md) explica a localização do banco local, backup e restauração.

## Arquitetura

- `app/pos-app.tsx` e `app/pos.css`: interface React responsiva, formulários, leitor, pagamentos e impressão.
- `lib/pos.ts`: regras de negócio e cálculos, compartilhados com testes.
- `app/login/`, `app/api/auth/` e `lib/auth-session.ts`: login com usuário/senha e sessão assinada em cookie HttpOnly.
- `app/api/pos/route.ts`: API autenticada; operador vem da identidade do servidor.
- `db/postgres-store.ts`: armazenamento PostgreSQL da versão web. Cada mutação bloqueia a revisão global dentro de uma transação antes de validar estoque e idempotência; uma falha desfaz a operação inteira.
- `db/postgres.sql`: referência do esquema PostgreSQL inicializado automaticamente pelo servidor.
- `tests/`: testes de regras de negócio, armazenamento PostgreSQL e autenticação. Os testes PostgreSQL usam PGlite em uma base isolada.
- `desktop/`: aplicativo Electron, transporte IPC e armazenamento SQLite local, reutilizando a interface e as regras de negócio.

A implementação carrega o histórico da loja para montar as telas. Para operações com histórico muito extenso, o próximo passo de escala é paginação/consultas por período no servidor. A exportação JSON fornece uma cópia dos dados; a interface web não oferece restauração. O aplicativo Windows permite importar essa exportação, conforme seu guia.

Os arquivos `db/store.ts`, `db/schema.ts`, `drizzle/`, a configuração Cloudflare e os scripts `sites:dev`, `sites:build` e `sites:start` pertencem à hospedagem anterior em ChatGPT Sites. São mantidos como legado e não fazem parte da execução web atual com Next.js/PostgreSQL. `db:generate` também atende a esse esquema legado, não ao PostgreSQL atual.

Referências técnicas: [React](https://react.dev/), [Next.js](https://nextjs.org/docs), [PostgreSQL](https://www.postgresql.org/docs/current/) e [transações postgres.js](https://github.com/porsager/postgres#transactions).

## Testes e validação

- A suíte de domínio cobre cálculos, pagamento misto, parcelas, devoluções, crediário, estoque, idempotência, datas e sessões de caixa.
- A suíte PostgreSQL verifica persistência, transações, rollback e recuperação de operações usando uma base PGlite isolada.
- Os testes de autenticação verificam credenciais, assinatura, validade e invalidação de sessões.
- Os testes do aplicativo Windows verificam SQLite, importação e fluxos do executável com internet desativada e dados separados da loja.

A interface já foi validada com cadastro, leitor por código e Enter, desconto, dinheiro/troco, comprovante, recarregamento, estoque, devolução parcial, crediário e recebimentos. Também foram verificados recuperação após falha de resposta, layout móvel e impressão PDF de 80 mm.

As verificações locais usam bases próprias, sem transações na loja em produção. Os testes do leitor simulam digitação e Enter; confira o equipamento físico antes de começar a operação na loja.
