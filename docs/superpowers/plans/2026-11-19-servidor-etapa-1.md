# Servidor da etapa 1 (pagamento automático e painel) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** o cliente paga online pela InfinitePay, o servidor confirma o pagamento sozinho e o pedido chega pago num painel com duas contas (dono e equipe).

**Arquitetura:** um único Cloudflare Worker serve o site estático (pasta `public/`), a API (`/api/...`) e o painel (`/painel/`). Os dados ficam no Cloudflare D1. O login do painel é o Cloudflare Access (e-mail + código); o Worker confere o token do Access e o papel de cada e-mail numa tabela. Os preços vêm de `public/js/dados.js`, o mesmo arquivo que o site usa, importado pelo Worker.

**Tecnologias:** JavaScript puro (sem framework), Cloudflare Workers + Static Assets, D1 (SQLite), Wrangler 4, Vitest com `@cloudflare/vitest-pool-workers`, Playwright (Chromium) para os testes de ponta a ponta.

**Spec:** [The Flavor Grill — Desenho da etapa 1](https://claude.ai/artifact/CMYFabUxu8qtgZddp31g4E) (aprovado em 2026-11-19).

## Restrições globais

- Valores de dinheiro no servidor sempre em **centavos inteiros**. O navegador nunca manda preço; só ids, quantidades e escolhas.
- Pedido não pago expira em **17 minutos**. O painel atualiza a cada **15 segundos**.
- InfiniteTag (handle): `rian-gustavo`. Chave de API em segredo `INFINITEPAY_API_KEY`, nunca no código.
- Link da InfinitePay: `options.valid_until` = criação + 17 min (ISO 8601 com `-03:00`), `options.assured_installments: 0`, `options.single_payment: true`. A resposta traz o link no campo `url`.
- Um pedido só vira `pago` quando `POST /payment_check` responde `paid: true`. O webhook e a URL de retorno nunca bastam sozinhos.
- Status do pedido: `aguardando_pagamento`, `pago`, `em_preparo`, `saiu_para_entrega`, `entregue`, `cancelado`, `expirado`.
- Cupons: `FLAVOR10` = 10% com mínimo de R$ 70,00 em produtos; `BEMVINDO` = R$ 5,00 só para WhatsApp sem nenhum pedido pago antes. Um cupom por pedido. O uso conta só depois do pagamento.
- Entrega: combo na sacola = grátis; senão, faixas de `FAIXAS_ENTREGA` (até 3 km R$ 5, até 6 km R$ 7, até 10 km R$ 10, acima R$ 14) pela distância em linha reta até `LOJA`.
- Nominatim só no servidor: no máximo 1 consulta por segundo, `User-Agent: TheFlavorGrill/1.0 (+https://flavorgrill.com.br)`, resultado guardado por CEP. ViaCEP continua no navegador só para preencher rua e bairro.
- Papéis: `dono` (tudo) e `equipe` (pedidos, status, WhatsApp, abrir/fechar loja). `DONO_EMAIL` em variável de ambiente é sempre dono.
- Dados: pedidos pagos apagados após 12 meses; não pagos após 7 dias (limpeza preguiçosa, sem Cron).
- Textos em português do Brasil. Contraste WCAG AA e áreas de toque de 44 px, como no site atual.
- WhatsApp da loja: `5583998903631`.

## Review Focus

1. **Aviso falso de pagamento:** um POST no webhook sem pagamento real não pode virar `pago` (Tarefa 8).
2. **Pagamento que chega depois de expirar ou com a loja fechada:** o dinheiro entrou, então o pedido aparece como `pago`, com alerta no painel (Tarefa 8).
3. **Dois pedidos pendentes com BEMVINDO do mesmo WhatsApp:** só o primeiro é aceito (Tarefa 7).
4. **CEP sem distância calculável e sem combo:** o pedido é recusado com `entrega_indisponivel`, e o site oferece o botão do WhatsApp em vez de cobrar uma taxa errada (Tarefas 7 e 12).
5. **Painel sem internet por alguns minutos:** mostra "Sem conexão", volta sozinho e não toca o aviso de novo para pedidos já vistos (Tarefa 11).

## Decisões minhas (não estão no spec)

- O link da InfinitePay leva **um único item**, "Pedido FGxxxxx — The Flavor Grill", com o total já com entrega e desconto. Motivo: a InfinitePay não aceita item de preço negativo (desconto) nem abaixo de R$ 1,00. Os itens detalhados ficam no banco e no painel.
- A animação da vaquinha passa a dizer **"Pedido recebido! Indo para o pagamento…"**, e depois o navegador vai para o link da InfinitePay na mesma aba.
- O cliente volta para `/?pedido=FGxxxxx`. O site consulta o status a cada 3 s por até 60 s. Se ainda não estiver pago, mostra que a confirmação pode levar alguns minutos e o botão do WhatsApp.
- Access protege `/painel*` e `/api/painel*` com a política "qualquer e-mail com código". Quem entra de verdade é decidido pela tabela `equipe`, gerenciada no próprio painel.
- Para testes locais, `ACESSO_DEV_EMAIL` (só em `.dev.vars`) é aceito apenas quando `AMBIENTE === "dev"` **e** o host é `localhost` ou `127.0.0.1`.
- Limite de 3 pedidos `aguardando_pagamento` não expirados por WhatsApp.

---

### Task 1: Estrutura do Worker servindo o site

**Arquivos:**
- Mover: `index.html`, `site.webmanifest`, `css/`, `js/`, `assets/` → `public/`
- Criar: `package.json`, `wrangler.jsonc`, `vitest.config.js`, `.gitignore` (adicionar `node_modules/`, `.wrangler/`, `.dev.vars`), `worker/index.js`, `test/saude.test.js`
- Modificar: `public/js/dados.js` (exportação para o servidor no fim do arquivo)

**Interfaces:**
- Produz: `export default { fetch(request, env, ctx) }` em `worker/index.js`, com um roteador que as próximas tarefas estendem: `rota(metodo, caminho, handler)`, onde o handler recebe `(request, env, ctx, params)` e devolve `Response`. Helper `json(dados, status = 200)`.
- Produz: `import dados from "../public/js/dados.js"` devolve `{ CATEGORIAS, ADICIONAIS, PRECO_COMBO, FAIXAS_ENTREGA, LOJA, buscarItem, buscarAdicional, taxaPorDistancia }`.

- [ ] **Passo 1: Testes que falham** em `test/saude.test.js`:
  - `GET /api/saude` → 200 com `{ ok: true }`.
  - `GET /` → 200 e o HTML contém "The Flavor Grill".
  - `dados.buscarItem("classico").preco === 24.9` e `dados.taxaPorDistancia(4) === 7`.
- [ ] **Passo 2:** `npx vitest run test/saude.test.js` → FALHA.
- [ ] **Passo 3:** criar os arquivos.
  - `wrangler.jsonc`: `name: "flavorgrill"`, `main: "worker/index.js"`, `compatibility_date: "2026-11-01"`, `assets: { directory: "./public", binding: "ASSETS", run_worker_first: ["/api/*"] }`, binding D1 `DB` (`database_name: "flavorgrill"`, `database_id` provisório), `vars: { INFINITEPAY_HANDLE: "rian-gustavo", SITE_URL: "", DONO_EMAIL: "", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", AMBIENTE: "producao", INFINITEPAY_BASE: "https://api.checkout.infinitepay.io" }`.
  - Fim de `dados.js`: `if (typeof module !== "undefined") { module.exports = {...}; }` (no navegador `module` não existe e nada muda).
  - `package.json`: dependências de desenvolvimento `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `@playwright/test`. Scripts: `"dev": "wrangler dev"`, `"test": "vitest run"`.
- [ ] **Passo 4:** `npx vitest run` → PASSA. `npx wrangler dev` abre o site em `http://localhost:8787` igual ao de hoje.
- [ ] **Passo 5:** commit `feat: worker serve o site e expõe /api/saude`.

### Task 2: Banco de dados

**Arquivos:**
- Criar: `migrations/0001_inicial.sql`, `worker/banco.js`, `test/banco.test.js`

**Interfaces:**
- Produz tabelas:
  - `pedidos(codigo TEXT PK, status TEXT, criado_em INTEGER, expira_em INTEGER, pago_em INTEGER, cliente_nome, cliente_whatsapp, endereco_json, itens_json, observacoes, cupom_codigo, subtotal INTEGER, desconto INTEGER, entrega INTEGER, total INTEGER, distancia_km REAL, link_url, valor_pago INTEGER, metodo, recibo_url, transacao_nsu, slug, alerta TEXT, atualizado_em INTEGER)`, com índices em `(cliente_whatsapp, status)` e `(status, pago_em)`.
  - `cupons(codigo TEXT PK, tipo TEXT CHECK(tipo IN ('porcentagem','fixo')), valor INTEGER, minimo INTEGER, primeira_compra INTEGER, ativo INTEGER, valido_ate INTEGER NULL, limite_usos INTEGER NULL)`. Em `porcentagem`, `valor` = porcentagem inteira; em `fixo`, centavos.
  - `equipe(email TEXT PK, papel TEXT CHECK(papel IN ('dono','equipe')), criado_em INTEGER)`.
  - `config(chave TEXT PK, valor TEXT)`, começando com `loja_aberta = '0'`.
  - `ceps(cep TEXT PK, distancia_km REAL, atualizado_em INTEGER)`.
  - Seed: `FLAVOR10` (porcentagem 10, mínimo 7000) e `BEMVINDO` (fixo 500, mínimo 0, primeira_compra 1).
- Produz em `worker/banco.js`: `agora() -> number` (ms; trocável nos testes), `lerConfig(env, chave) -> Promise<string|null>`, `gravarConfig(env, chave, valor)`, `limparAntigos(env)` (apaga não pagos com mais de 7 dias e pagos com mais de 12 meses; chamado no máximo uma vez por hora, controlado por `config.ultima_limpeza`).

- [ ] **Passo 1: Testes que falham:** depois das migrações, `SELECT` dos dois cupons do seed; `lerConfig(env, "loja_aberta") === "0"`; `limparAntigos` apaga um pedido `aguardando_pagamento` de 8 dias, mantém um `pago` de 30 dias e só roda uma vez dentro da mesma hora.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar. O `vitest.config.js` aplica `migrations/` antes dos testes (`applyD1Migrations`).
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: banco D1 com pedidos, cupons, equipe e config`.

### Task 3: Cálculo do pedido

**Arquivos:**
- Criar: `worker/pedido.js`, `test/pedido.test.js`

**Interfaces:**
- Consome: `dados` (Tarefa 1).
- Produz: `calcularItens(linhas) -> { itens: [{ id, nome, quantidade, unitario, combo, adicionais, burguers, observacao, descricao }], subtotal, temCombo }` (centavos). Em caso de erro, lança `ErroPedido(codigo, mensagem)`.
  - `linhas[]` = `{ id, quantidade, combo?, adicionais?, burguers?, observacao? }`, no mesmo formato da sacola do site (`carrinho.js`).
  - Regras: o item existe; quantidade inteira de 1 a 50; `combo` só se `podeSerCombo`; adicionais só em itens com `podeSerCombo` e só ids de `ADICIONAIS`, sem repetir; `burguers` obrigatório com exatamente `escolherBurguers` ids, todos dentro de `burguersPermitidos`; observação cortada em 140 caracteres; no máximo 30 linhas.
  - Unitário = `round(preco*100) + (combo ? PRECO_COMBO*100 : 0) + adicionais + acréscimos dos burguers`, a mesma conta de `calcularPrecoUnitario` no site.
- Produz: `ErroPedido` (classe com `codigo`).

- [ ] **Passo 1: Testes que falham:**
  - 1× `classico` → subtotal 2490.
  - `classico` com combo e `cheddar` → unitário 2490 + 2000 + 500 = 4990.
  - `combo-casal` com `["prime","prime"]` → 8990 + 2400 = 11390, e `temCombo` true.
  - `combo-casal` com 1 burguer → `ErroPedido("burguers_invalidos")`.
  - id `"x"` → `item_inexistente`; quantidade 0 ou 51 → `quantidade_invalida`.
  - `coca-lata` com `combo: true` → `combo_invalido`; `fritas-gg` com adicional → `adicional_invalido`.
  - Para **todo** item de `CATEGORIAS`: `calcularItens([{id, quantidade:1, ...burguers mínimos}]).subtotal === Math.round(preco*100) + acréscimos`. Protege contra divergência com o site.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar `calcularItens`. `descricao` é a linha pronta para o painel, por exemplo "2× F Bacon (combo) · Cheddar cremoso".
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: cálculo do pedido no servidor`.

### Task 4: Entrega pelo CEP

**Arquivos:**
- Criar: `worker/entrega.js`, `test/entrega.test.js`
- Modificar: `worker/index.js` (rota `POST /api/entrega`)

**Interfaces:**
- Produz: `distanciaDoCep(env, { cep, rua, bairro }) -> Promise<number|null>` (km, 1 casa decimal).
  - Ordem: cache em `ceps` (até 90 dias) → ViaCEP para cidade e UF → Nominatim pela rua (`street`, `city`, `state`) → Nominatim pelo bairro, aceitando só `addresstype` em `suburb`, `neighbourhood`, `quarter` ou `city_district` → `null`.
  - A distância é Haversine até `LOJA`, a mesma conta de `distanciaKm` no site.
  - Espera de 1,1 s entre consultas ao Nominatim, controlada por `config.ultima_consulta_mapa`.
  - Grava no cache só quando acha a distância.
- Produz: `taxaEntrega(distanciaKm) -> centavos` (`taxaPorDistancia * 100`).
- Rota `POST /api/entrega { cep, rua?, bairro? }` → `{ distanciaKm, taxa }` ou `{ erro: "entrega_indisponivel" }` (status 422). CEP sem 8 dígitos → 400.

- [ ] **Passo 1: Testes que falham** (fetch externo simulado com `fetchMock`):
  - CEP em cache → nenhuma chamada externa.
  - Rua encontrada → distância calculada e cache gravado.
  - Rua sem resultado e bairro com `addresstype: "stadium"` e depois `"suburb"` → usa o `suburb`.
  - Nada encontrado → `null` e nada gravado.
  - O cabeçalho `User-Agent` enviado ao Nominatim é exatamente o das restrições globais.
  - `taxaEntrega(2.9) === 500`, `taxaEntrega(10.1) === 1400`.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: taxa de entrega calculada no servidor`.

### Task 5: Cupons

**Arquivos:**
- Criar: `worker/cupons.js`, `test/cupons.test.js`
- Modificar: `worker/index.js` (rota `POST /api/cupons/verificar`)

**Interfaces:**
- Produz: `avaliarCupom(env, codigo, { whatsapp, subtotal, ignorarPedido? }) -> Promise<{ ok: true, codigo, desconto } | { ok: false, motivo, mensagem }>`.
  - Normaliza o código (maiúsculas, sem espaços).
  - Motivos: `inexistente`, `inativo`, `vencido`, `esgotado` (pedidos pagos com o cupom ≥ `limite_usos`), `minimo` (mensagem com o valor), `primeira_compra` (já existe pedido pago desse WhatsApp), `em_uso` (para BEMVINDO: já existe outro pedido `aguardando_pagamento` não expirado desse WhatsApp com o mesmo cupom).
  - Desconto: porcentagem arredondada para baixo em centavos; fixo limitado ao subtotal.
- Rota `POST /api/cupons/verificar { codigo, whatsapp, subtotal }` → o resultado acima. O site usa só para mostrar; o valor que vale é recalculado no pedido.

- [ ] **Passo 1: Testes que falham:**
  - FLAVOR10 com subtotal 6990 → `minimo`; com 8990 → desconto 899.
  - BEMVINDO para WhatsApp novo → 500; com um pedido `pago` desse WhatsApp → `primeira_compra`.
  - BEMVINDO com um pedido pendente desse WhatsApp usando BEMVINDO → `em_uso`; o mesmo pendente já expirado → ok.
  - Cupom com `ativo = 0` → `inativo`; com `valido_ate` no passado → `vencido`.
  - " flavor10 " → reconhecido.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: cupons validados no servidor`.

### Task 6: Cliente da InfinitePay

**Arquivos:**
- Criar: `worker/infinitepay.js`, `test/infinitepay.test.js`

**Interfaces:**
- Produz: `criarLink(env, pedido) -> Promise<string>` (a `url`). Faz `POST {INFINITEPAY_BASE}/links` com:
  - `handle`.
  - `items: [{ quantity: 1, price: pedido.total, description: "Pedido " + codigo + " — The Flavor Grill" }]`.
  - `order_nsu: codigo`.
  - `redirect_url: SITE_URL + "/?pedido=" + codigo`.
  - `webhook_url: SITE_URL + "/api/infinitepay/webhook"`.
  - `customer: { name, phone_number: "+55" + whatsapp }`.
  - `address: { cep, street, number, neighborhood, city: "João Pessoa", state: "PB", complement }`.
  - Com `INFINITEPAY_API_KEY`: cabeçalho `X-Api-Key` e `options: { valid_until, assured_installments: 0, single_payment: true }`.
  - Erro HTTP ou sem `url` → lança `ErroPagamento`.
- Produz: `conferirPagamento(env, { codigo, transacaoNsu, slug }) -> Promise<{ pago: boolean, valor: number|null, valorPago: number|null, metodo: string|null }>`. Faz `POST {INFINITEPAY_BASE}/payment_check` com `{ handle, order_nsu, transaction_nsu, slug }`. `success:false` ou `paid:false` → `pago: false`. Erro de rede ou HTTP ≥ 500 → lança `ErroPagamento`.
- Produz: `validoAte(ms) -> string` (ISO com `-03:00`), por exemplo `validoAte(Date.UTC(2026,10,19,21,0)) === "2026-11-19T18:00:00-03:00"`.

- [ ] **Passo 1: Testes que falham:** o corpo enviado bate exatamente com o acima (com e sem chave de API); a resposta `{ url }` é devolvida; resposta 400 → `ErroPagamento`; `payment_check` com `paid:true` → `pago:true` e valores; com `success:false` → `pago:false`; HTTP 503 → lança.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: cliente do checkout da InfinitePay`.

### Task 7: Criar pedido e estado da loja

**Arquivos:**
- Criar: `worker/rotas-pedido.js`, `test/rotas-pedido.test.js`
- Modificar: `worker/index.js`

**Interfaces:**
- Consome: Tarefas 2 a 6.
- Rota `GET /api/loja` → `{ aberta: boolean }`.
- Rota `POST /api/pedidos`. Corpo: `{ itens: linhas[], cliente: { nome, whatsapp }, endereco: { cep, rua, numero, bairro, referencia? }, cupom?, observacoes? }`.
  - Sucesso: 201 `{ codigo, url }`.
  - Erros: `{ erro, mensagem }` com 409 `loja_fechada`; 400 `dados_invalidos` (nome com 2 a 60 caracteres, WhatsApp com 10 ou 11 dígitos, CEP com 8, rua, número e bairro obrigatórios); 422 `entrega_indisponivel`; 422 cupom (motivo da Tarefa 5); 429 `muitos_pedidos`; 400 dos erros de `calcularItens`; 502 `pagamento_indisponivel`.
  - Ordem: loja aberta → dados do cliente → `calcularItens` → entrega (combo = 0, senão `distanciaDoCep` + `taxaEntrega`) → limite de 3 pendentes por WhatsApp → cupom → total ≥ 100 → gera o código `FG` + 5 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (único) → grava `aguardando_pagamento` com `expira_em = agora + 17 min` → `criarLink` → grava `link_url`. Se `criarLink` falhar, apaga o pedido.
  - Chama `limparAntigos` via `ctx.waitUntil`.

- [ ] **Passo 1: Testes que falham:**
  - Loja fechada → 409.
  - Pedido válido com combo → 201, entrega 0, total igual ao subtotal, link criado com `price` igual ao total.
  - Sem combo com distância 4,2 km simulada → entrega 700.
  - CEP sem distância e sem combo → 422 `entrega_indisponivel`, nenhum pedido gravado.
  - Preço enviado pelo navegador no corpo é ignorado.
  - Quarto pedido pendente do mesmo WhatsApp → 429.
  - Segundo pedido com BEMVINDO do mesmo WhatsApp enquanto o primeiro está pendente → 422 `em_uso` (Review Focus 3).
  - Falha da InfinitePay → 502 e o pedido não fica no banco.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: criação de pedido com link de pagamento`.

### Task 8: Confirmação do pagamento

**Arquivos:**
- Criar: `worker/rotas-pagamento.js`, `test/rotas-pagamento.test.js`
- Modificar: `worker/index.js`

**Interfaces:**
- Produz: `confirmarPedido(env, codigo, { transacaoNsu, slug, recibo }) -> Promise<status>`.
  - Se o pedido já estiver em `pago` ou num status depois dele, devolve sem consultar a InfinitePay.
  - Senão, chama `conferirPagamento`. Se pago: grava `pago`, `pago_em`, `valor_pago`, `metodo`, `transacao_nsu`, `slug`, `recibo_url` e `alerta`.
  - Alertas, juntos por " · ": "valor diferente do pedido" quando `valor !== total`; "pago depois de expirar" quando `agora > expira_em`; "loja estava fechada" quando `loja_aberta` é "0".
- Rota `POST /api/infinitepay/webhook` (corpo da InfinitePay: `order_nsu`, `transaction_nsu`, `invoice_slug`, `receipt_url`).
  - Pedido desconhecido → 200 (ignora).
  - `ErroPagamento` → 400, para a InfinitePay tentar de novo.
  - Senão → 200 `{ ok: true }`.
- Rota `GET /api/pedidos/:codigo?transaction_nsu=&slug=` → `{ codigo, status, total }`. Com os parâmetros e o pedido ainda pendente, chama `confirmarPedido`. Nunca devolve dados do cliente.
- Pedido pendente com `agora > expira_em` é lido como `expirado`, mas ainda pode virar `pago`.

- [ ] **Passo 1: Testes que falham:**
  - Webhook com `payment_check` simulado `paid:false` → continua `aguardando_pagamento` (Review Focus 1).
  - Webhook com `paid:true` e valor igual → `pago`, sem alerta.
  - Webhook repetido → 200 e só uma consulta à InfinitePay.
  - Pagamento depois de 17 min com a loja fechada → `pago` com os dois alertas (Review Focus 2).
  - `payment_check` HTTP 503 → webhook responde 400.
  - `GET /api/pedidos/FGXXXXX` sem parâmetros → só status; a resposta não contém "whatsapp" nem "nome".
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: confirmação do pagamento via payment_check`.

### Task 9: Quem está no painel

**Arquivos:**
- Criar: `worker/acesso.js`, `test/acesso.test.js`

**Interfaces:**
- Produz: `identificar(request, env) -> Promise<{ email, papel } | null>`.
  - Lê `Cf-Access-Jwt-Assertion` e valida RS256 com as chaves de `https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (guardadas por 1 h), `aud` contendo `ACCESS_AUD`, `iss` igual a `https://{ACCESS_TEAM_DOMAIN}` e `exp` no futuro.
  - E-mail em minúsculas. `DONO_EMAIL` → `dono`; senão, o papel vem da tabela `equipe`; senão → `null`.
  - Exceção de desenvolvimento: `AMBIENTE === "dev"` e host `localhost` ou `127.0.0.1` → usa `ACESSO_DEV_EMAIL`.
- Produz: `exigir(papel)`, que envolve um handler: sem identidade → 401 `{ erro: "sem_acesso" }`; papel insuficiente → 403.

- [ ] **Passo 1: Testes que falham** (o teste gera um par RSA e serve as chaves por `fetchMock`):
  - Token válido do dono → `dono`.
  - Token válido de e-mail cadastrado como equipe → `equipe`.
  - E-mail fora da tabela → `null`.
  - `aud` errado, assinatura de outra chave ou expirado → `null`.
  - `ACESSO_DEV_EMAIL` com `AMBIENTE: "producao"` → `null`; com host `flavorgrill.workers.dev` → `null`.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar com `crypto.subtle.importKey("jwk", ...)` e `verify("RSASSA-PKCS1-v1_5")`.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: identificação do painel via Cloudflare Access`.

### Task 10: API do painel

**Arquivos:**
- Criar: `worker/rotas-painel.js`, `test/rotas-painel.test.js`
- Modificar: `worker/index.js`

**Interfaces** (todas com `exigir`; o papel mínimo vem entre colchetes):
- `GET /api/painel/eu` [equipe] → `{ email, papel }`.
- `GET /api/painel/pedidos` [equipe] → `{ pedidos: [...] }`, com os pedidos em `pago`, `em_preparo` ou `saiu_para_entrega`, mais os `entregue` e `cancelado` das últimas 12 h, do mais antigo para o mais novo. Cada pedido traz código, status, `pago_em`, cliente, endereço, itens (`descricao`), observações, total, entrega, cupom, método e alerta. Pendentes nunca aparecem.
- `POST /api/painel/pedidos/:codigo/status { status }` [equipe] → só avança na ordem `pago → em_preparo → saiu_para_entrega → entregue`; outra transição → 409.
- `POST /api/painel/pedidos/:codigo/cancelar` [dono] → `cancelado`. A resposta lembra de estornar no app da InfinitePay.
- `GET/POST /api/painel/loja { aberta }` [equipe].
- `GET /api/painel/cupons` e `POST /api/painel/cupons` (cria, ou edita pelo código: tipo, valor, mínimo, primeira compra, ativo, validade, limite) [dono]. A listagem traz os usos pagos de cada cupom.
- `GET /api/painel/resumo` [dono] → `{ hoje: { pedidos, vendas, ticketMedio }, semana: {...} }`, só com pedidos pagos e não cancelados, em dia de São Paulo (UTC−3). A semana são os últimos 7 dias, contando hoje.
- `GET/POST/DELETE /api/painel/equipe` [dono] → lista, adiciona `{ email, papel }` ou remove. Não deixa remover o `DONO_EMAIL`.

- [ ] **Passo 1: Testes que falham:**
  - Equipe: lista pedidos, avança status e abre a loja.
  - Equipe recebe 403 em cancelar, cupons, resumo e equipe.
  - Pendente não aparece na lista.
  - `entregue → em_preparo` → 409.
  - Resumo com 2 pedidos pagos hoje (3000 e 5000) e 1 cancelado → `{ pedidos: 2, vendas: 8000, ticketMedio: 4000 }`.
  - Criar o cupom `NATAL5` e usar em `avaliarCupom`.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: API do painel do dono e da equipe`.

### Task 11: Tela do painel

**Arquivos:**
- Criar: `public/painel/index.html`, `public/painel/painel.js`, `public/painel/painel.css`, `test/e2e/painel.spec.js`, `playwright.config.js` (sobe `wrangler dev` com `.dev.vars` de teste)

**Interfaces:**
- Consome: as rotas da Tarefa 10.
- Tela pensada para celular, com as mesmas fontes e cores do site:
  - **Topo:** chave "Loja aberta / fechada" e e-mail de quem entrou.
  - **Abas:** Pedidos (todos), Cupons, Resumo e Equipe (essas três só para o dono).
  - **Cartão de pedido:** código, hora, itens, observações, endereço, total, alerta em destaque, botão do próximo status, "Chamar no WhatsApp" (`https://wa.me/55<whatsapp>`) e "Cancelar" (só dono, com confirmação).
  - **Atualização:** a cada 15 s. Sem resposta → faixa "Sem conexão, tentando de novo…", que some quando volta.
  - **Som:** tocado com WebAudio depois que a pessoa toca em "Ativar som", só para códigos ainda não vistos, guardados em memória e `sessionStorage`.
  - **Sem acesso (401):** "Seu e-mail não tem acesso. Peça ao dono para adicionar."

- [ ] **Passo 1: Testes que falham** (Playwright, 390×844, `ACESSO_DEV_EMAIL` como dono):
  - Um pedido pago criado no banco aparece em até 16 s.
  - Tocar em "Em preparo" muda o cartão.
  - Com `ACESSO_DEV_EMAIL` de equipe, as abas Cupons, Resumo e Equipe não aparecem.
  - Com a rede derrubada (`context.setOffline(true)`), aparece "Sem conexão"; ao religar, some, e o contador de som não aumenta para pedidos já vistos (Review Focus 5).
  - Varredura de contraste (`scripts/contraste.py` adaptado) e áreas de toque ≥ 44 px.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar → PASSA.
- [ ] **Passo 5:** commit `feat: tela do painel`.

### Task 12: Site usa o servidor

**Arquivos:**
- Modificar: `public/index.html`, `public/js/checkout.js`, `public/js/cupom.js`, `public/js/carrinho.js`, `public/js/dados.js`, `public/css/style.css`, `README.md`
- Remover: `public/js/pix.js`, `public/js/vendor/qrcode.js`; de `dados.js`, `PIX_*`, `CUPONS`, `USAR_OPENSTREETMAP` e `CHAVE_DISTANCIAS`
- Criar: `public/privacidade.html`, `test/e2e/pedido.spec.js`, `test/e2e/infinitepay-falsa.js` (servidor local que imita `/links` e `/payment_check`)

**Interfaces:**
- **Ao abrir:** `GET /api/loja`.
  - Loja fechada: faixa "Estamos fechados agora. Volte mais tarde!" e "Continuar" desabilitado.
  - Falha de rede ou 5xx: faixa "Pedidos pelo site indisponíveis no momento" com o botão "Pedir pelo WhatsApp".
- **Entrega:** ViaCEP continua preenchendo rua e bairro. A distância e a taxa vêm de `POST /api/entrega`. Com `entrega_indisponivel` e sem combo, aparece "Não entregamos nesse endereço pelo site" com o botão do WhatsApp, e o pagamento fica bloqueado.
- **Cupom:** `POST /api/cupons/verificar`, mostrando a `mensagem` do servidor.
- **Pagamento (opção A):**
  - Bloco único "Pagamento online": "Pix ou cartão de crédito. Ao finalizar, você paga na página segura da InfinitePay e seu pedido vai direto pra cozinha."
  - Botão "Ir para o pagamento".
  - Uma linha acima do botão: "Ao continuar, você concorda com o uso dos seus dados para a entrega." com link para `privacidade.html`.
- **Envio:** `POST /api/pedidos`. A vaquinha mostra "Pedido recebido! Indo para o pagamento…" por 1,3 s e depois `location.assign(url)`. Em caso de erro, a mensagem do servidor aparece perto do botão.
- **Retorno `/?pedido=FG…`:** abre a sacola na etapa "pronto" e consulta `GET /api/pedidos/:codigo` repassando `transaction_nsu` e `slug` da URL, a cada 3 s por até 60 s.
  - Pago: vaquinha com "Pedido FGxxxxx pago!" e o botão opcional do WhatsApp. Esvazia a sacola.
  - Sem confirmação: "Ainda não recebemos a confirmação. Se você já pagou, ela chega em instantes." mais o botão do WhatsApp.
- **`privacidade.html`:** quais dados são guardados (nome, WhatsApp, endereço, itens), para quê (entrega e contato sobre o pedido), por quanto tempo (12 meses pagos, 7 dias não pagos), quem vê (dono e equipe) e como pedir exclusão (WhatsApp).

- [ ] **Passo 1: Testes que falham** (Playwright com `wrangler dev` e a InfinitePay falsa):
  - Loja fechada → "Continuar" desabilitado.
  - Servidor desligado → faixa com o botão do WhatsApp.
  - Fluxo completo: monta Combo Casal → preenche os dados → "Ir para o pagamento" → a InfinitePay falsa recebe `price` 8990 → simula o webhook pago → `/?pedido=` mostra "pago" → o pedido aparece no painel.
  - CEP sem distância e sem combo → aviso com o botão do WhatsApp e pagamento bloqueado (Review Focus 4).
  - Nenhuma requisição do navegador para `nominatim.openstreetmap.org`.
  - Contraste e áreas de toque iguais aos do site atual.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar. O README passa a explicar a nova estrutura e onde ficam os preços.
- [ ] **Passo 4:** rodar → PASSA, mais `npx vitest run` inteiro.
- [ ] **Passo 5:** commit `feat: site paga online pelo servidor`.

### Task 13: Guia para ligar na Cloudflare

**Arquivos:**
- Criar: `docs/LIGAR-NA-CLOUDFLARE.md`
- Modificar: `wrangler.jsonc` (deixa o `database_id` pronto para receber o do Rian)

**Interfaces:** é um guia para o Rian, sem terminal, todo pelo painel da Cloudflare:
1. Criar o banco D1 `flavorgrill` e copiar o ID (não é segredo).
2. Ligar o repositório `flavorgrill-site` em Workers & Pages → Importar do GitHub.
3. Rodar a migração.
4. Cadastrar o segredo `INFINITEPAY_API_KEY`, copiando a chave da InfinitePay e colando direto na Cloudflare.
5. Preencher `SITE_URL` e `DONO_EMAIL`.
6. Criar o Access (aplicação para `/painel*` e `/api/painel*`, login por código no e-mail) e copiar `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD`.
7. Abrir a loja no painel.
8. Teste de R$ 1 no Pix.

- [ ] **Passo 1:** escrever o guia e conferir cada nome de menu na documentação atual da Cloudflare antes de publicar.
- [ ] **Passo 2:** commit `docs: guia para ligar o servidor na Cloudflare`.
