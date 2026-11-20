import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../worker/index.js";
import { lerConfig } from "../worker/banco.js";
import { avaliarCupom } from "../worker/cupons.js";
import { inserirPedido } from "./fabricas.js";

const DONO = "dono@flavorgrill.test";
const EQUIPE = "cozinha@flavorgrill.test";
const ctx = { waitUntil() {} };

beforeAll(async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO equipe (email, papel, criado_em) VALUES (?, 'equipe', 0)").bind(EQUIPE).run();
});
afterEach(() => vi.restoreAllMocks());

async function chamar(email, metodo, caminho, corpo) {
    const ambiente = { ...env, AMBIENTE: "dev", ACESSO_DEV_EMAIL: email };
    const resposta = await worker.fetch(new Request("http://localhost:8787" + caminho, {
        method: metodo, body: corpo ? JSON.stringify(corpo) : undefined
    }), ambiente, ctx);
    return { status: resposta.status, dados: await resposta.json() };
}

describe("API do painel", () => {
    it("sem login responde 401", async () => {
        const resposta = await worker.fetch(new Request("https://flavorgrill.test/api/painel/pedidos"), env, ctx);
        expect(resposta.status).toBe(401);
    });

    it("diz quem está logado", async () => {
        expect((await chamar(EQUIPE, "GET", "/api/painel/eu")).dados).toEqual({ email: EQUIPE, papel: "equipe" });
    });

    it("a equipe vê pedidos pagos, avança o status e abre a loja", async () => {
        await inserirPedido({ codigo: "FGPNL01", status: "pago", pagoEm: Date.now(), itens: [{ descricao: "1× F Clássico" }] });
        await inserirPedido({ codigo: "FGPNL02" });
        const { dados } = await chamar(EQUIPE, "GET", "/api/painel/pedidos");
        const codigos = dados.pedidos.map(p => p.codigo);
        expect(codigos).toContain("FGPNL01");
        expect(codigos).not.toContain("FGPNL02");
        const cartao = dados.pedidos.find(p => p.codigo === "FGPNL01");
        expect(cartao).toMatchObject({ status: "pago", cliente: { nome: "Ana", whatsapp: "83999998888" }, itens: [{ descricao: "1× F Clássico" }], total: 5000 });
        expect(cartao.endereco.rua).toBe("Rua A");

        expect((await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL01/status", { status: "em_preparo" })).status).toBe(200);
        expect((await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL01/status", { status: "entregue" })).status).toBe(409);
        await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL01/status", { status: "saiu_para_entrega" });
        await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL01/status", { status: "entregue" });
        expect((await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL01/status", { status: "em_preparo" })).status).toBe(409);

        expect((await chamar(EQUIPE, "POST", "/api/painel/loja", { aberta: true })).dados).toEqual({ aberta: true });
        expect(await lerConfig(env, "loja_aberta")).toBe("1");
    });

    it("a equipe não cancela, não mexe em cupons, resumo nem equipe", async () => {
        await inserirPedido({ codigo: "FGPNL03", status: "pago", pagoEm: Date.now() });
        expect((await chamar(EQUIPE, "POST", "/api/painel/pedidos/FGPNL03/cancelar")).status).toBe(403);
        expect((await chamar(EQUIPE, "GET", "/api/painel/cupons")).status).toBe(403);
        expect((await chamar(EQUIPE, "GET", "/api/painel/resumo")).status).toBe(403);
        expect((await chamar(EQUIPE, "GET", "/api/painel/equipe")).status).toBe(403);
    });

    it("o dono cancela com lembrete de estorno", async () => {
        await inserirPedido({ codigo: "FGPNL04", status: "pago", pagoEm: Date.now() });
        const { status, dados } = await chamar(DONO, "POST", "/api/painel/pedidos/FGPNL04/cancelar");
        expect(status).toBe(200);
        expect(dados.mensagem).toContain("InfinitePay");
        expect((await env.DB.prepare("SELECT status FROM pedidos WHERE codigo = 'FGPNL04'").first()).status).toBe("cancelado");
    });

    it("resumo do dia conta só pagos não cancelados, no horário de Brasília", async () => {
        const meioDia = Date.UTC(2030, 0, 15, 15, 0); // 12h em João Pessoa
        vi.spyOn(Date, "now").mockReturnValue(meioDia);
        await inserirPedido({ codigo: "FGRES01", status: "entregue", pagoEm: meioDia - 3600000, total: 3000, criadoEm: meioDia - 3600000 });
        await inserirPedido({ codigo: "FGRES02", status: "pago", pagoEm: meioDia - 60000, total: 5000, criadoEm: meioDia - 60000 });
        await inserirPedido({ codigo: "FGRES03", status: "cancelado", pagoEm: meioDia - 60000, total: 9000, criadoEm: meioDia - 60000 });
        await inserirPedido({ codigo: "FGRES04", status: "pago", pagoEm: Date.UTC(2030, 0, 15, 2, 0), total: 1000, criadoEm: Date.UTC(2030, 0, 15, 2, 0) }); // 23h do dia anterior
        const { dados } = await chamar(DONO, "GET", "/api/painel/resumo");
        expect(dados.hoje).toEqual({ pedidos: 2, vendas: 8000, ticketMedio: 4000 });
        expect(dados.semana).toEqual({ pedidos: 3, vendas: 9000, ticketMedio: 3000 });
    });

    it("o dono cria e edita cupons, que passam a valer", async () => {
        const criar = await chamar(DONO, "POST", "/api/painel/cupons", { codigo: "natal5", tipo: "fixo", valor: 500, minimo: 3000, primeiraCompra: false, ativo: true, validoAte: null, limiteUsos: 10 });
        expect(criar.status).toBe(200);
        expect((await avaliarCupom(env, "NATAL5", { whatsapp: "83900000001", subtotal: 4000 })).desconto).toBe(500);
        await chamar(DONO, "POST", "/api/painel/cupons", { codigo: "NATAL5", tipo: "fixo", valor: 500, minimo: 3000, primeiraCompra: false, ativo: false, validoAte: null, limiteUsos: 10 });
        expect((await avaliarCupom(env, "NATAL5", { whatsapp: "83900000001", subtotal: 4000 })).motivo).toBe("inativo");
        const { dados } = await chamar(DONO, "GET", "/api/painel/cupons");
        expect(dados.cupons.find(c => c.codigo === "NATAL5")).toMatchObject({ ativo: false, limiteUsos: 10, usos: 0 });
        expect((await chamar(DONO, "POST", "/api/painel/cupons", { codigo: "X", tipo: "porcentagem", valor: 150 })).status).toBe(400);
    });

    it("o dono gerencia a equipe, mas não remove a si mesmo", async () => {
        expect((await chamar(DONO, "POST", "/api/painel/equipe", { email: "Nova@FlavorGrill.test", papel: "equipe" })).status).toBe(200);
        expect((await chamar("nova@flavorgrill.test", "GET", "/api/painel/eu")).dados.papel).toBe("equipe");
        expect((await chamar(DONO, "DELETE", "/api/painel/equipe", { email: "nova@flavorgrill.test" })).status).toBe(200);
        expect((await chamar("nova@flavorgrill.test", "GET", "/api/painel/eu")).status).toBe(401);
        expect((await chamar(DONO, "DELETE", "/api/painel/equipe", { email: DONO })).status).toBe(400);
    });
});
