import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../worker/index.js";
import { gravarConfig } from "../worker/banco.js";
import { simularFetch } from "./simular-fetch.js";

const ctx = { waitUntil() {} };
let sequencia = 0;

function corpoPedido(extra = {}) {
    sequencia += 1;
    return {
        itens: [{ id: "combo-casal", quantidade: 1, burguers: ["classico", "bacon"] }],
        cliente: { nome: "Ana Souza", whatsapp: "(83) 9" + String(10000000 + sequencia).slice(-8), email: " Ana.Souza@Email.com " },
        endereco: { cep: "58055-000", rua: "Rua das Flores", numero: "10", bairro: "Mangabeira", referencia: "" },
        ...extra
    };
}

function enviar(corpo) {
    return worker.fetch(new Request("https://flavorgrill.test/api/pedidos", { method: "POST", body: JSON.stringify(corpo) }), env, ctx);
}

function linkFalso() {
    return simularFetch([["/links", { url: "https://checkout.infinitepay.io/teste" }]]);
}

beforeEach(async () => {
    await gravarConfig(env, "loja_aberta", "1");
    await env.DB.prepare("INSERT OR REPLACE INTO ceps (cep, distancia_km, atualizado_em) VALUES ('58055000', 4.2, ?)").bind(Date.now()).run();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/loja", () => {
    it("diz se a loja está aberta", async () => {
        const aberta = await worker.fetch(new Request("https://flavorgrill.test/api/loja"), env, ctx);
        expect(await aberta.json()).toEqual({ aberta: true });
        await gravarConfig(env, "loja_aberta", "0");
        const fechada = await worker.fetch(new Request("https://flavorgrill.test/api/loja"), env, ctx);
        expect(await fechada.json()).toEqual({ aberta: false });
    });
});

describe("POST /api/pedidos", () => {
    it("recusa com a loja fechada", async () => {
        await gravarConfig(env, "loja_aberta", "0");
        const resposta = await enviar(corpoPedido());
        expect(resposta.status).toBe(409);
        expect((await resposta.json()).erro).toBe("loja_fechada");
    });

    it("cria o pedido com combo, entrega grátis e link com o total", async () => {
        const { chamadas } = linkFalso();
        const resposta = await enviar(corpoPedido());
        expect(resposta.status).toBe(201);
        const { codigo, url } = await resposta.json();
        expect(codigo).toMatch(/^FG[A-HJ-NP-Z2-9]{5}$/);
        expect(url).toBe("https://checkout.infinitepay.io/teste");
        const pedido = await env.DB.prepare("SELECT * FROM pedidos WHERE codigo = ?").bind(codigo).first();
        expect(pedido).toMatchObject({ status: "aguardando_pagamento", subtotal: 8990, entrega: 0, total: 8990, link_url: url });
        expect(pedido.expira_em - pedido.criado_em).toBe(17 * 60000);
        expect(chamadas[0].corpo.items[0].price).toBe(8990);
    });

    it("cobra a entrega pela distância quando não há combo", async () => {
        linkFalso();
        const resposta = await enviar(corpoPedido({ itens: [{ id: "classico", quantidade: 1 }] }));
        const { codigo } = await resposta.json();
        const pedido = await env.DB.prepare("SELECT entrega, total, distancia_km FROM pedidos WHERE codigo = ?").bind(codigo).first();
        expect(pedido).toEqual({ entrega: 700, total: 2490 + 700, distancia_km: 4.2 });
    });

    it("ignora preço enviado pelo navegador", async () => {
        const { chamadas } = linkFalso();
        await enviar(corpoPedido({ itens: [{ id: "classico", quantidade: 1, preco: 1 }], total: 100 }));
        expect(chamadas[0].corpo.items[0].price).toBe(3190);
    });

    it("recusa quando não dá para calcular a entrega e não tem combo", async () => {
        simularFetch([["viacep.com.br", { erro: true }]]);
        const corpo = corpoPedido({ itens: [{ id: "classico", quantidade: 1 }] });
        corpo.endereco.cep = "58999-999";
        const resposta = await enviar(corpo);
        expect(resposta.status).toBe(422);
        expect((await resposta.json()).erro).toBe("entrega_indisponivel");
        const { total } = await env.DB.prepare("SELECT COUNT(*) AS total FROM pedidos WHERE cliente_whatsapp = ?").bind(corpo.cliente.whatsapp.replace(/\D/g, "")).first();
        expect(total).toBe(0);
    });

    it("manda o e-mail do cliente para a InfinitePay já preenchido, sem guardar no banco", async () => {
        const { chamadas } = linkFalso();
        const corpo = corpoPedido();
        const resposta = await enviar(corpo);
        expect(resposta.status).toBe(201);
        expect(chamadas[0].corpo.customer.email).toBe("ana.souza@email.com");
        const { codigo } = await resposta.json();
        const linha = await env.DB.prepare("SELECT * FROM pedidos WHERE codigo = ?").bind(codigo).first();
        expect(JSON.stringify(linha)).not.toContain("email.com");
    });

    it("recusa e-mail inválido ou vazio", async () => {
        for (const email of ["", "ana@", "ana souza@email.com", "a".repeat(250) + "@x.com"]) {
            const corpo = corpoPedido();
            corpo.cliente.email = email;
            const resposta = await enviar(corpo);
            expect(resposta.status).toBe(400);
            const dados = await resposta.json();
            expect(dados.erro).toBe("dados_invalidos");
            expect(dados.mensagem).toBe("Confira seu nome, WhatsApp, e-mail e endereço.");
        }
    });

    it("valida os dados do cliente", async () => {
        const corpo = corpoPedido();
        corpo.cliente.whatsapp = "123";
        const resposta = await enviar(corpo);
        expect(resposta.status).toBe(400);
        expect((await resposta.json()).erro).toBe("dados_invalidos");
    });

    it("limita a 3 pedidos aguardando pagamento por WhatsApp", async () => {
        linkFalso();
        const corpo = corpoPedido();
        for (let i = 0; i < 3; i++) {
            expect((await enviar(corpo)).status).toBe(201);
        }
        expect((await enviar(corpo)).status).toBe(429);
    });

    it("aceita só um pedido pendente com BEMVINDO por WhatsApp", async () => {
        linkFalso();
        const corpo = corpoPedido({ cupom: "bemvindo" });
        const primeiro = await enviar(corpo);
        expect(primeiro.status).toBe(201);
        const { codigo } = await primeiro.json();
        const pedido = await env.DB.prepare("SELECT desconto, total, cupom_codigo FROM pedidos WHERE codigo = ?").bind(codigo).first();
        expect(pedido).toEqual({ desconto: 500, total: 8490, cupom_codigo: "BEMVINDO" });
        const segundo = await enviar(corpo);
        expect(segundo.status).toBe(422);
        expect((await segundo.json()).erro).toBe("em_uso");
    });

    it("se a InfinitePay falhar, responde 502 e não guarda o pedido", async () => {
        simularFetch([["/links", new Response("erro", { status: 500 })]]);
        const corpo = corpoPedido();
        const resposta = await enviar(corpo);
        expect(resposta.status).toBe(502);
        const { total } = await env.DB.prepare("SELECT COUNT(*) AS total FROM pedidos WHERE cliente_whatsapp = ?").bind(corpo.cliente.whatsapp.replace(/\D/g, "")).first();
        expect(total).toBe(0);
    });
});
