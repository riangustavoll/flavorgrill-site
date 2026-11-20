# Ligar o site e o servidor na Cloudflare

Tudo pelo navegador, sem terminal. Leva mais ou menos 40 minutos.

> **Segurança:** a chave da InfinitePay e o seu e-mail nunca vão para o GitHub nem para o chat. Eles são colados direto na Cloudflare, como **Secret**.
>
> Os nomes de menus seguem a documentação da Cloudflare de novembro de 2026. Se alguma tela estiver diferente, use a busca do painel da Cloudflare pelo nome do item.

## Antes de começar

- Conta na Cloudflare com verificação em duas etapas ligada (**My Profile > Authentication**).
- O repositório `flavorgrill-site` no seu GitHub, com este código.
- Acesso ao app da InfinitePay, com o **Checkout Integrado** ligado.

## 1. Criar o banco de dados

1. No painel da Cloudflare, vá em **Storage & databases > D1 SQL database**.
2. Clique em **Create Database**, dê o nome `flavorgrill` e crie.
3. Na página do banco, copie o **Database ID** (um código como `a1b2c3d4-...`). Ele não é segredo.

## 2. Colocar o ID do banco no código

1. No GitHub, abra o arquivo `wrangler.jsonc` e clique no lápis (**Edit this file**).
2. Troque `00000000-0000-0000-0000-000000000000` pelo ID que você copiou. Mantenha as aspas.
3. Clique em **Commit changes**.

## 3. Criar as tabelas

1. Volte no banco `flavorgrill` (**Storage & databases > D1 SQL database > flavorgrill**) e abra a aba **Console**.
2. No GitHub, abra `migrations/0001_inicial.sql`, copie todo o conteúdo (botão **Copy raw file**), cole no Console e clique em **Execute**.
3. Ainda no Console, cole e execute este trecho. Ele registra que a tabela já foi criada, para que futuras atualizações do banco funcionem:

   ```sql
   CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
   INSERT INTO d1_migrations (name) VALUES ('0001_inicial.sql');
   ```

4. Confira na aba **Tables**: devem aparecer `pedidos`, `cupons`, `equipe`, `config` e `ceps`.

## 4. Publicar o site a partir do GitHub

1. Vá em **Compute > Workers & Pages** e clique em **Create application**.
2. Ao lado de **Import a repository**, clique em **Get started** e conecte sua conta do GitHub. Na autorização, escolha **Only select repositories** e marque só `flavorgrill-site`.
3. Selecione `flavorgrill-site` e confira:
   - **Project name:** `flavorgrill`
   - **Build command:** deixe vazio
   - **Deploy command:** `npx wrangler deploy`
4. Clique em **Save and Deploy** e espere o build terminar com sucesso (1 a 3 minutos).
5. Abra o Worker `flavorgrill` e copie o endereço que termina em `.workers.dev` (por exemplo, `https://flavorgrill.seunome.workers.dev`). Esse é o endereço do site até o domínio ficar pronto.

A partir de agora, cada commit na `main` publica o site sozinho.

## 5. Cadastrar a chave da InfinitePay, seu e-mail e o endereço do site

No Worker `flavorgrill`, vá em **Settings > Variables and Secrets** e clique em **Add** para cada item:

| Tipo | Variable name | Value |
|---|---|---|
| Secret | `DONO_EMAIL` | seu e-mail (o mesmo que vai usar para entrar no painel) |
| Text | `SITE_URL` | o endereço do passo 4, **sem barra no final** |
| Secret | `INFINITEPAY_API_KEY` | a chave da InfinitePay (veja abaixo) |

**A chave da InfinitePay:** gere agora, no app da InfinitePay, na área do **Checkout Integrado**. Ela começa com `inchk_` e aparece uma vez só: copie e cole direto no campo **Value** da Cloudflare. Não mande a chave para ninguém, nem no chat. Se perder, gere outra e troque aqui.

Clique em **Deploy** para salvar.

## 6. Proteger o painel com login por código no e-mail

### 6.1 Ativar o Zero Trust (só na primeira vez)

1. No painel da Cloudflare, clique em **Zero Trust**.
2. Escolha um nome de equipe, por exemplo `flavorgrill`. O endereço de login vira `flavorgrill.cloudflareaccess.com`.
3. Escolha o plano **Free**. A Cloudflare pede um cartão para cadastro, mas o plano gratuito não cobra nada (até 50 pessoas).

### 6.2 Criar a proteção do painel

1. Em **Zero Trust > Access controls > Applications**, clique em **Create new application** e escolha **Self-hosted and private**.
2. Dê o nome `Painel Flavor Grill`.
3. Clique em **Add public hostname** e preencha:
   - **Domain:** o endereço `.workers.dev` do passo 4, sem `https://` (se não aparecer na lista, use **Switch to custom input** e digite)
   - **Path:** `painel`
4. Clique em **Add public hostname** de novo, com o mesmo domínio e **Path:** `api/painel`.
5. Em **Access policies**, crie uma política:
   - **Action:** Allow
   - **Include:** Everyone
   
   Quem entra de verdade é decidido na aba **Equipe** do painel: e-mails que não estão lá veem "Seu e-mail não tem acesso". Se quiser uma trava a mais, troque **Everyone** por **Emails** e liste só o seu e o da pessoa de confiança (aí, para incluir alguém novo, precisa mudar aqui também).
6. Em login, deixe marcado **One-time PIN** (código enviado por e-mail).
7. Salve com **Create**.

### 6.3 Copiar os dois códigos do Access

- **Team domain:** em **Zero Trust > Settings**, copie o domínio da equipe, no formato `flavorgrill.cloudflareaccess.com` (sem `https://`).
- **AUD:** em **Zero Trust > Access controls > Applications**, clique em **Edit** no `Painel Flavor Grill` e, em **Additional settings**, copie o **Application Audience (AUD) Tag**.

Nenhum dos dois é segredo. Volte em **Workers & Pages > flavorgrill > Settings > Variables and Secrets** e adicione:

| Tipo | Variable name | Value |
|---|---|---|
| Text | `ACCESS_TEAM_DOMAIN` | o team domain |
| Text | `ACCESS_AUD` | o AUD |

Clique em **Deploy**.

## 7. Entrar no painel e abrir a loja

1. Abra `https://SEU-ENDERECO.workers.dev/painel` no celular.
2. Digite seu e-mail, receba o código e entre. O painel mostra seu e-mail e as abas **Pedidos, Cupons, Resumo e Equipe**.
3. Na aba **Equipe**, adicione o e-mail da pessoa de confiança como **equipe**.
4. Toque no botão **Loja fechada** para ele virar **Loja aberta**.

## 8. Pedido de teste de R$ 1,00 no Pix

1. Na aba **Cupons**, crie o cupom `TESTE1`: tipo valor fixo, desconto **R$ 63,90**, limite de usos **1**, ativo.
2. No site, peça um **Combo Petisco** (R$ 64,90, entrega grátis por ser combo), use o cupom `TESTE1` e confira que o total ficou **R$ 1,00**.
3. Toque em **Ir para o pagamento** e pague no Pix pela página da InfinitePay.
4. Confira:
   - o site volta mostrando **Pedido FG… pago!**;
   - o pedido aparece no painel em até 15 segundos;
   - o R$ 1,00 aparece no app da InfinitePay.
5. No painel, cancele o pedido de teste e pause o cupom `TESTE1` (desmarque **Ativo**). Se quiser o R$ 1,00 de volta, faça o estorno no app da InfinitePay.

Se tudo isso deu certo, a loja está pronta para vender.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| O build do passo 4 falha | Confira se o ID do banco no `wrangler.jsonc` está certo e entre aspas. Em **Workers & Pages > flavorgrill > Deployments**, abra o build com erro e me mande o texto do erro (não tem nenhum segredo nele). |
| O site mostra "Pedidos pelo site indisponíveis no momento" | As tabelas do passo 3 não foram criadas, ou o build falhou. |
| "Ir para o pagamento" dá erro | Confira `SITE_URL` (com `https://` e sem barra no final) e a chave `INFINITEPAY_API_KEY`. |
| O painel diz "Seu e-mail não tem acesso" com o seu e-mail | Confira se o `DONO_EMAIL` está igual ao e-mail do login. |
| O painel não pede código e mostra erro | Confira `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` e se os dois caminhos do passo 6.2 foram salvos. |
| Pagou e o site não confirmou | Espere 1 minuto e atualize o painel. Confira no app da InfinitePay se o pagamento entrou. |

## Depois: domínio próprio

Quando registrar `flavorgrill.com.br`:

1. Adicione o domínio em **Workers & Pages > flavorgrill > Domains**.
2. Troque `SITE_URL` para `https://flavorgrill.com.br`.
3. No Access (passo 6.2), adicione os dois caminhos também para o novo domínio.
