# The Flavor Grill — Site de pedidos

Site de pedidos da hamburgueria **The Flavor Grill**, delivery em João Pessoa (PB). O cliente monta o pedido no cardápio e paga online pelo Pix ou cartão de crédito. O pedido pago aparece sozinho no painel da loja, sem aplicativo de delivery no meio e sem comissão por venda.

🔗 **Site:** `flavorgrill.com.br` (domínio ainda a registrar). Enquanto isso, o endereço é o `*.workers.dev` que a Cloudflare cria.

## Como o cliente faz o pedido

1. **Escolhe** os burguers, combos, adicionais e porções no cardápio.
2. **Preenche** nome, WhatsApp e CEP. O site completa rua e bairro e o servidor calcula a taxa de entrega pela distância.
3. **Paga online** na página segura da InfinitePay (Pix ou cartão de crédito à vista).
4. **Volta para o site**, que confirma o pagamento. O pedido já está no painel da loja.

Se o servidor estiver fora do ar, o site mostra um aviso com o botão **Pedir pelo WhatsApp**.

## Como a loja trabalha

- **Painel** em `/painel` (protegido pelo Cloudflare Access, com código por e-mail):
  - **Pedidos:** os pagos chegam sozinhos (atualiza a cada 15 s, com som opcional). Botões para avançar o status (em preparo → saiu para entrega → entregue) e chamar o cliente no WhatsApp.
  - **Botão Loja aberta / fechada:** com a loja fechada, o site não aceita pedidos.
  - Só o dono: **cancelar pedido** (o estorno é feito no app da InfinitePay), **cupons**, **resumo** do dia e da semana e **equipe** (quem pode entrar no painel).
- Pedido não pago expira em **17 minutos**.

## Funcionalidades

- **Cardápio** em abas (Menu Flavor, Combos, Adicionais e Porções), com opção de transformar qualquer burguer em combo.
- **Sacola** com quantidades, adicionais e observações, salva no navegador.
- **Taxa de entrega pelo CEP:** o servidor calcula a distância em linha reta até a loja. Pedidos com combo têm entrega grátis.

  | Distância | Taxa |
  |---|---|
  | até 3 km | R$ 5,00 |
  | até 6 km | R$ 7,00 |
  | até 10 km | R$ 10,00 |
  | acima de 10 km | R$ 14,00 |

- **Preço calculado no servidor:** o navegador manda só os itens; o servidor confere cardápio, adicionais, cupom e entrega e cria o link de pagamento com o total certo.
- **Cupons de desconto** criados e pausados no painel: porcentagem ou valor fixo, valor mínimo, validade, limite de usos e "só na primeira compra" (conferida pelo WhatsApp nos pedidos pagos).
- **Feito para celular** (Android e iPhone): janela do item em formato de gaveta, área segura do iPhone, ícone para adicionar à tela inicial.
- **Acessibilidade:** contraste de cores dentro da WCAG AA, áreas de toque de 44 px, navegação completa pelo teclado, rótulos em todos os campos.

## Como atualizar

| O que | Onde |
|---|---|
| Itens, preços, descrições e combos | `CATEGORIAS` em [`public/js/dados.js`](public/js/dados.js) |
| Adicionais | `ADICIONAIS` em `public/js/dados.js` |
| Valor para virar combo | `PRECO_COMBO` em `public/js/dados.js` |
| Faixas da taxa de entrega | `FAIXAS_ENTREGA` em `public/js/dados.js` |
| Localização da loja | `LOJA` em `public/js/dados.js` |
| Número do WhatsApp da loja | `NUMERO_WHATSAPP` em `public/js/dados.js` |
| CNPJ e endereço no rodapé | Em `public/index.html`, linha `rodape-empresa`: troque os dados e apague o `hidden` |
| Cupons, loja aberta, equipe | No painel (`/painel`), sem mexer no código |

O site e o servidor leem os mesmos preços do `dados.js`, então basta mudar em um lugar. Depois de editar, faça o commit na `main`: a Cloudflare publica a nova versão sozinha.

## Estrutura

```
public/                → site (arquivos estáticos)
  index.html
  privacidade.html     → como usamos os dados do cliente
  painel/              → painel da loja (pedidos, cupons, resumo, equipe)
  css/  js/  assets/
worker/                → servidor (Cloudflare Workers)
  index.js             → rotas da /api
  rotas-pedido.js      → cria o pedido e o link de pagamento
  rotas-pagamento.js   → aviso da InfinitePay (webhook) e status do pedido
  rotas-painel.js      → rotas do painel
  infinitepay.js  entrega.js  cupons.js  pedido.js  acesso.js  banco.js
migrations/            → tabelas do banco D1
test/                  → testes (vitest) e testes no navegador (test/e2e, Playwright)
docs/                  → plano e guia para ligar na Cloudflare
```

## Testes

```
npm install
npm test                                 # servidor (vitest)
cd test/e2e && python3 -m pytest -q      # site e painel no navegador (Playwright)
```

## Serviços externos

| Serviço | Para que | Regras de uso |
|---|---|---|
| [Cloudflare Workers, D1 e Access](https://www.cloudflare.com/) | Hospedar o site e o servidor, guardar pedidos e proteger o painel | Plano gratuito |
| [InfinitePay — Checkout](https://www.infinitepay.io/) | Página de pagamento (Pix e cartão) e aviso de pagamento | Taxas da InfinitePay |
| [ViaCEP](https://viacep.com.br/) | Transformar o CEP em rua, bairro e cidade (no navegador) | Serviço gratuito e público |
| [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/) | Localizar a rua para calcular a distância (no servidor) | [Política de uso](https://operations.osmfoundation.org/policies/nominatim/) |
| WhatsApp (`wa.me`) | Falar com a loja | Termos de uso do WhatsApp |

Cuidados com o Nominatim: só o servidor consulta, no máximo 1 vez por segundo, com identificação própria (User-Agent), e cada CEP fica guardado por 90 dias para não repetir a busca. O crédito "© colaboradores do OpenStreetMap" aparece abaixo do campo de CEP.

## Privacidade

Resumo da página [`privacidade.html`](public/privacidade.html):

- O site pede só o necessário: nome, WhatsApp e endereço de entrega.
- Pedidos pagos ficam guardados por 12 meses; os não pagos, por 7 dias. A limpeza é automática.
- Só a equipe da loja vê os pedidos, no painel. Os dados do cartão ficam só com a InfinitePay.
- O site não usa cookies de propaganda, ferramentas de análise ou rastreamento.
- O cliente pode pedir a exclusão dos dados pelo WhatsApp.

## Créditos e licenças

| Material | Autoria / origem | Licença |
|---|---|---|
| Código do site | The Flavor Grill, com apoio de IA (Claude, da Anthropic) | Todos os direitos reservados |
| Logo e mascote | Criados por Rian Gustavo Levino Luna no Canva | Termos de licença do Canva |
| Fontes Bebas Neue, Modak e Montserrat | Dharma Type, Ek Type e The Montserrat Project Authors, via [Fontsource](https://fontsource.org/) | [SIL Open Font License 1.1](public/assets/fonts/OFL.txt) |
| Dados de localização | © colaboradores do OpenStreetMap | [ODbL](https://www.openstreetmap.org/copyright) |
| Ícone do WhatsApp | Desenho simplificado, só para identificar o botão | A marca WhatsApp pertence à Meta |

## Hospedagem

- Cloudflare Workers (plano gratuito), publicado a partir da branch `main`. O passo a passo está em [`docs/LIGAR-NA-CLOUDFLARE.md`](docs/LIGAR-NA-CLOUDFLARE.md).
- Domínio `flavorgrill.com.br`, a registrar no Registro.br.
