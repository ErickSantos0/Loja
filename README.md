# Fio — caixa e estoque para loja de roupas

Aplicação em React e TypeScript, com backend autenticado e banco de dados Cloudflare D1 (SQLite). A versão publicada é privada e usa a conta ChatGPT do proprietário para entrar. Os dados ficam no servidor, compartilhados entre os dispositivos que acessarem a mesma loja; esta versão exige internet.

## Usar na loja

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
cd "C:\Users\nasci\Downloads\Compras e vendas\caixa-loja"
npm ci
npm run build
```

Na primeira configuração de uma base local vazia, aplique a migração:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fantastic_slipstream.sql
npm run dev
```

Não reaplique a migração sobre uma base já inicializada. Abra o endereço exibido pelo servidor e visite `/signin-with-chatgpt?return_to=/` para entrar como operador local **Seedy**. O login simulado funciona somente no desenvolvimento local e não é incluído na publicação. O banco local em `.wrangler/state` é separado do banco publicado. Os dados usados nos testes não são enviados à loja publicada.

```powershell
npm run check
npm test
```

Para alterar o esquema físico do banco, edite `db/schema.ts` e gere novas migrações com `npm run db:generate`. Preserve migrações já aplicadas.

## Arquitetura

- `app/pos-app.tsx` e `app/pos.css`: interface React responsiva, formulários, leitor, pagamentos e impressão.
- `lib/pos.ts`: regras de negócio e cálculos, compartilhados com testes.
- `app/api/pos/route.ts`: API autenticada; operador vem da identidade do servidor.
- `db/store.ts`: registros individuais no banco, com revisão global e transação D1. Uma revisão concorrente faz o lote falhar por CHECK e a operação é relida/revalidada, sem gravar estoque ou pagamento parcialmente.
- `db/schema.ts` e `drizzle/`: esquema e migração.
- `tests/pos.test.mjs`: testes de regras de negócio.

A implementação carrega o histórico da loja para montar as telas. Para operações com histórico muito extenso, o próximo passo de escala é paginação/consultas por período no servidor. A exportação JSON fornece uma cópia dos dados; não há restauração automática pela interface.

Referências técnicas: [React](https://react.dev/reference/react/useEffect) e [transações D1](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## Verificação realizada

- 11 testes automatizados de cálculos, pagamento misto, parcelas, devoluções, crediário, estoque, idempotência, validação de datas e sessões de caixa.
- Fluxos reais no navegador: cadastro, leitor por código e Enter, desconto de 10%, dinheiro/troco, comprovante, recarregamento, estoque, devolução parcial, cliente, crediário misto, recebimento parcial e devolução integral.
- API com banco D1 local: concorrência na última unidade, envio concorrente com mesmo identificador, operação inválida sem gravação parcial, sessão antiga rejeitada e acesso sem login rejeitado.
- Falha de resposta após gravação, recuperação sem duplicar venda, layout móvel e impressão PDF.

As verificações locais usam uma base própria, sem transações na loja publicada.
