import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { lerConfig, gravarConfig, limparAntigos } from "../worker/banco.js";

const DIA = 24 * 60 * 60 * 1000;

async function inserirPedido(codigo, status, criadoEm, pagoEm = null) {
    await env.DB.prepare(
        "INSERT INTO pedidos (codigo, status, criado_em, expira_em, pago_em, cliente_nome, cliente_whatsapp, endereco_json, itens_json, subtotal, desconto, entrega, total, atualizado_em) VALUES (?, ?, ?, ?, ?, 'Ana', '83999998888', '{}', '[]', 1000, 0, 0, 1000, ?)"
    ).bind(codigo, status, criadoEm, criadoEm + 17 * 60000, pagoEm, criadoEm).run();
}

async function existe(codigo) {
    return Boolean(await env.DB.prepare("SELECT 1 FROM pedidos WHERE codigo = ?").bind(codigo).first());
}

afterEach(() => vi.restoreAllMocks());

describe("banco de dados", () => {
    it("começa com os cupons FLAVOR10 e BEMVINDO", async () => {
        const { results } = await env.DB.prepare("SELECT codigo, tipo, valor, minimo, primeira_compra, ativo FROM cupons ORDER BY codigo").all();
        expect(results).toEqual([
            { codigo: "BEMVINDO", tipo: "fixo", valor: 500, minimo: 0, primeira_compra: 1, ativo: 1 },
            { codigo: "FLAVOR10", tipo: "porcentagem", valor: 10, minimo: 7000, primeira_compra: 0, ativo: 1 }
        ]);
    });

    it("começa com a loja fechada e grava configurações", async () => {
        expect(await lerConfig(env, "loja_aberta")).toBe("0");
        await gravarConfig(env, "loja_aberta", "1");
        expect(await lerConfig(env, "loja_aberta")).toBe("1");
        expect(await lerConfig(env, "nao_existe")).toBeNull();
    });

    it("apaga não pagos com mais de 7 dias e mantém pagos recentes, uma vez por hora", async () => {
        const agora = Date.UTC(2026, 10, 19, 22, 0);
        vi.spyOn(Date, "now").mockReturnValue(agora);
        await inserirPedido("FGVELHO", "aguardando_pagamento", agora - 8 * DIA);
        await inserirPedido("FGPAGO1", "entregue", agora - 30 * DIA, agora - 30 * DIA);
        await inserirPedido("FGANTIG", "entregue", agora - 400 * DIA, agora - 400 * DIA);

        await limparAntigos(env);
        expect(await existe("FGVELHO")).toBe(false);
        expect(await existe("FGANTIG")).toBe(false);
        expect(await existe("FGPAGO1")).toBe(true);

        await inserirPedido("FGOUTRO", "aguardando_pagamento", agora - 9 * DIA);
        await limparAntigos(env); // mesma hora: não roda de novo
        expect(await existe("FGOUTRO")).toBe(true);
    });
});
