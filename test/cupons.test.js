import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../worker/index.js";
import { avaliarCupom } from "../worker/cupons.js";
import { inserirPedido } from "./fabricas.js";

const NOVO = "83911112222";

describe("cupons no servidor", () => {
    it("FLAVOR10 exige R$ 70 em produtos e dá 10%", async () => {
        const abaixo = await avaliarCupom(env, "FLAVOR10", { whatsapp: NOVO, subtotal: 6990 });
        expect(abaixo).toMatchObject({ ok: false, motivo: "minimo" });
        expect(abaixo.mensagem).toContain("R$ 70,00");
        expect(await avaliarCupom(env, "FLAVOR10", { whatsapp: NOVO, subtotal: 8999 })).toEqual({ ok: true, codigo: "FLAVOR10", desconto: 899 });
    });

    it("reconhece o código com espaços e minúsculas", async () => {
        expect((await avaliarCupom(env, " flavor10 ", { whatsapp: NOVO, subtotal: 9000 })).ok).toBe(true);
    });

    it("BEMVINDO só vale para quem nunca teve pedido pago", async () => {
        expect(await avaliarCupom(env, "BEMVINDO", { whatsapp: NOVO, subtotal: 2490 })).toEqual({ ok: true, codigo: "BEMVINDO", desconto: 500 });
        await inserirPedido({ codigo: "FGPAGO1", status: "entregue", whatsapp: NOVO, pagoEm: Date.now() - 1000 });
        expect(await avaliarCupom(env, "BEMVINDO", { whatsapp: NOVO, subtotal: 2490 })).toMatchObject({ ok: false, motivo: "primeira_compra" });
    });

    it("BEMVINDO fica em uso enquanto outro pedido pendente do mesmo WhatsApp o usa", async () => {
        const zap = "83955556666";
        await inserirPedido({ codigo: "FGPEND1", whatsapp: zap, cupom: "BEMVINDO" });
        expect(await avaliarCupom(env, "BEMVINDO", { whatsapp: zap, subtotal: 2490 })).toMatchObject({ ok: false, motivo: "em_uso" });
    });

    it("pedido pendente já expirado não bloqueia o BEMVINDO", async () => {
        const antes = Date.now() - 60 * 60000;
        const zap = "83977778888";
        await inserirPedido({ codigo: "FGEXPI1", whatsapp: zap, cupom: "BEMVINDO", criadoEm: antes });
        expect((await avaliarCupom(env, "BEMVINDO", { whatsapp: zap, subtotal: 2490 })).ok).toBe(true);
    });

    it("cupom fixo não passa do subtotal", async () => {
        await env.DB.prepare("INSERT INTO cupons (codigo, tipo, valor, minimo) VALUES ('GRANDE', 'fixo', 9000, 0)").run();
        expect((await avaliarCupom(env, "GRANDE", { whatsapp: NOVO, subtotal: 2490 })).desconto).toBe(2490);
    });

    it("recusa cupom inexistente, pausado, vencido e esgotado", async () => {
        await env.DB.batch([
            env.DB.prepare("INSERT INTO cupons (codigo, tipo, valor, ativo) VALUES ('PAUSADO', 'fixo', 100, 0)"),
            env.DB.prepare("INSERT INTO cupons (codigo, tipo, valor, valido_ate) VALUES ('VENCIDO', 'fixo', 100, ?)").bind(Date.now() - 1000),
            env.DB.prepare("INSERT INTO cupons (codigo, tipo, valor, limite_usos) VALUES ('UMAVEZ', 'fixo', 100, 1)")
        ]);
        await inserirPedido({ codigo: "FGUSOU1", status: "pago", whatsapp: "83933334444", cupom: "UMAVEZ", pagoEm: Date.now() });
        const motivo = async codigo => (await avaliarCupom(env, codigo, { whatsapp: NOVO, subtotal: 5000 })).motivo;
        expect(await motivo("NADA")).toBe("inexistente");
        expect(await motivo("PAUSADO")).toBe("inativo");
        expect(await motivo("VENCIDO")).toBe("vencido");
        expect(await motivo("UMAVEZ")).toBe("esgotado");
    });

    it("POST /api/cupons/verificar responde para o site", async () => {
        const resposta = await worker.fetch(new Request("https://flavorgrill.test/api/cupons/verificar", {
            method: "POST", body: JSON.stringify({ codigo: "flavor10", whatsapp: "(83) 91111-2222", subtotal: 10000 })
        }), env, {});
        expect(await resposta.json()).toEqual({ ok: true, codigo: "FLAVOR10", desconto: 1000 });
    });
});
