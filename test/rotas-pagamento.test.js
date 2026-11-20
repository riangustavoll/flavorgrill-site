import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../worker/index.js";
import { gravarConfig } from "../worker/banco.js";
import { inserirPedido } from "./fabricas.js";
import { simularFetch } from "./simular-fetch.js";

const ctx = { waitUntil() {} };
afterEach(() => vi.restoreAllMocks());

function webhook(corpo) {
    return worker.fetch(new Request("https://flavorgrill.test/api/infinitepay/webhook", { method: "POST", body: JSON.stringify(corpo) }), env, ctx);
}

const avisoDe = codigo => ({ order_nsu: codigo, transaction_nsu: "t-" + codigo, invoice_slug: "s-" + codigo, receipt_url: "https://recibo/" + codigo, amount: 5000, paid_amount: 5000 });
const ler = codigo => env.DB.prepare("SELECT * FROM pedidos WHERE codigo = ?").bind(codigo).first();
const pago = valor => ({ success: true, paid: true, amount: valor, paid_amount: valor, capture_method: "pix" });

describe("confirmação do pagamento", () => {
    it("aviso falso (InfinitePay diz que não pagou) não vira pago", async () => {
        await gravarConfig(env, "loja_aberta", "1");
        await inserirPedido({ codigo: "FGFALS1" });
        simularFetch([["/payment_check", { success: false, paid: false }]]);
        const resposta = await webhook(avisoDe("FGFALS1"));
        expect(resposta.status).toBe(200);
        expect((await ler("FGFALS1")).status).toBe("aguardando_pagamento");
    });

    it("pagamento confirmado vira pago sem alerta", async () => {
        await gravarConfig(env, "loja_aberta", "1");
        await inserirPedido({ codigo: "FGPAGA1", total: 5000 });
        const { chamadas } = simularFetch([["/payment_check", pago(5000)]]);
        expect((await webhook(avisoDe("FGPAGA1"))).status).toBe(200);
        expect(chamadas[0].corpo).toMatchObject({ order_nsu: "FGPAGA1", transaction_nsu: "t-FGPAGA1", slug: "s-FGPAGA1" });
        const pedido = await ler("FGPAGA1");
        expect(pedido).toMatchObject({ status: "pago", valor_pago: 5000, metodo: "pix", recibo_url: "https://recibo/FGPAGA1", alerta: null });
        expect(pedido.pago_em).toBeGreaterThan(0);
    });

    it("aviso repetido não consulta a InfinitePay de novo", async () => {
        await inserirPedido({ codigo: "FGREPE1", total: 5000 });
        const { chamadas } = simularFetch([["/payment_check", pago(5000)]]);
        await webhook(avisoDe("FGREPE1"));
        expect((await webhook(avisoDe("FGREPE1"))).status).toBe(200);
        expect(chamadas).toHaveLength(1);
    });

    it("pago depois de expirar, com a loja fechada e valor maior: pago com alertas", async () => {
        await gravarConfig(env, "loja_aberta", "0");
        const antes = Date.now() - 30 * 60000;
        await inserirPedido({ codigo: "FGTARD1", total: 5000, criadoEm: antes });
        simularFetch([["/payment_check", pago(6000)]]);
        await webhook(avisoDe("FGTARD1"));
        const pedido = await ler("FGTARD1");
        expect(pedido.status).toBe("pago");
        expect(pedido.alerta).toBe("valor diferente do pedido · pago depois de expirar · loja estava fechada");
    });

    it("pagamento menor que o pedido (link feito por fora): não vai para a cozinha", async () => {
        await gravarConfig(env, "loja_aberta", "1");
        await inserirPedido({ codigo: "FGMENO1", total: 6490 });
        simularFetch([["/payment_check", pago(100)]]);
        expect((await webhook(avisoDe("FGMENO1"))).status).toBe(200);
        const pedido = await ler("FGMENO1");
        expect(pedido.status).toBe("aguardando_pagamento");
        expect(pedido.alerta).toBe("pagou R$ 1,00, menos que o pedido");
    });

    it("InfinitePay fora do ar: responde 400 para tentarem de novo", async () => {
        await inserirPedido({ codigo: "FGFORA1" });
        simularFetch([["/payment_check", new Response("fora", { status: 503 })]]);
        expect((await webhook(avisoDe("FGFORA1"))).status).toBe(400);
        expect((await ler("FGFORA1")).status).toBe("aguardando_pagamento");
    });

    it("pedido desconhecido é ignorado com 200", async () => {
        const { chamadas } = simularFetch([]);
        expect((await webhook(avisoDe("FGNADA1"))).status).toBe(200);
        expect(chamadas).toHaveLength(0);
    });
});

describe("GET /api/pedidos/:codigo", () => {
    it("mostra só o status, sem dados do cliente", async () => {
        await inserirPedido({ codigo: "FGSTAT1", total: 3190 });
        const resposta = await worker.fetch(new Request("https://flavorgrill.test/api/pedidos/FGSTAT1"), env, ctx);
        const texto = await resposta.text();
        expect(JSON.parse(texto)).toEqual({ codigo: "FGSTAT1", status: "aguardando_pagamento", total: 3190 });
        expect(texto).not.toMatch(/whatsapp|nome|Ana/i);
    });

    it("com os dados da volta do pagamento, confere e atualiza", async () => {
        await inserirPedido({ codigo: "FGVOLT1", total: 3190 });
        simularFetch([["/payment_check", pago(3190)]]);
        const resposta = await worker.fetch(new Request("https://flavorgrill.test/api/pedidos/FGVOLT1?transaction_nsu=t1&slug=s1"), env, ctx);
        expect((await resposta.json()).status).toBe("pago");
    });

    it("pendente vencido aparece como expirado; código inexistente dá 404", async () => {
        await inserirPedido({ codigo: "FGVENC1", criadoEm: Date.now() - 60 * 60000 });
        const vencido = await worker.fetch(new Request("https://flavorgrill.test/api/pedidos/FGVENC1"), env, ctx);
        expect((await vencido.json()).status).toBe("expirado");
        const nada = await worker.fetch(new Request("https://flavorgrill.test/api/pedidos/FGNADA9"), env, ctx);
        expect(nada.status).toBe(404);
    });
});
