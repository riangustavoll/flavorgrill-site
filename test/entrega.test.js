import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../worker/index.js";
import { distanciaDoCep, taxaEntrega } from "../worker/entrega.js";
import { simularFetch } from "./simular-fetch.js";

afterEach(() => vi.restoreAllMocks());

const VIACEP = { logradouro: "Rua das Flores", bairro: "Mangabeira", localidade: "João Pessoa", uf: "PB", estado: "Paraíba" };
// Ponto a ~4 km ao norte da loja (LOJA = -7.21453, -34.84629)
const PERTO = { lat: "-7.1786", lon: "-34.84629", addresstype: "road" };

describe("entrega pelo CEP", () => {
    it("usa o cache sem consultar a internet", async () => {
        await env.DB.prepare("INSERT INTO ceps (cep, distancia_km, atualizado_em) VALUES ('58000000', 3.4, ?)").bind(Date.now()).run();
        const { chamadas } = simularFetch([]);
        expect(await distanciaDoCep(env, { cep: "58000000" })).toBe(3.4);
        expect(chamadas).toHaveLength(0);
    });

    it("acha a rua, calcula a distância e grava no cache", async () => {
        const { chamadas } = simularFetch([["viacep.com.br", VIACEP], ["nominatim", [PERTO]]]);
        const km = await distanciaDoCep(env, { cep: "58055000" });
        expect(km).toBe(4);
        const nominatim = chamadas.find(c => c.url.includes("nominatim"));
        expect(nominatim.cabecalhos.get("user-agent")).toBe("TheFlavorGrill/1.0 (+https://flavorgrill.com.br)");
        expect(nominatim.url).toContain("street=Rua+das+Flores");
        const salvo = await env.DB.prepare("SELECT distancia_km FROM ceps WHERE cep = '58055000'").first();
        expect(salvo.distancia_km).toBe(4);
    });

    it("sem a rua, usa só resultado que seja bairro", async () => {
        simularFetch([
            ["viacep.com.br", VIACEP],
            ["street=", []],
            ["nominatim", [{ ...PERTO, lat: "-7.30", addresstype: "stadium" }, { ...PERTO, addresstype: "suburb" }]]
        ]);
        expect(await distanciaDoCep(env, { cep: "58055001" })).toBe(4);
    });

    it("devolve null e não grava quando nada é encontrado", async () => {
        simularFetch([["viacep.com.br", VIACEP], ["nominatim", []]]);
        expect(await distanciaDoCep(env, { cep: "58055002" })).toBeNull();
        expect(await env.DB.prepare("SELECT 1 FROM ceps WHERE cep = '58055002'").first()).toBeNull();
    });

    it("converte distância em taxa", () => {
        expect(taxaEntrega(2.9)).toBe(500);
        expect(taxaEntrega(10.1)).toBe(1400);
    });

    it("POST /api/entrega devolve distância e taxa", async () => {
        await env.DB.prepare("INSERT INTO ceps (cep, distancia_km, atualizado_em) VALUES ('58000001', 5.2, ?)").bind(Date.now()).run();
        const resposta = await worker.fetch(new Request("https://flavorgrill.test/api/entrega", { method: "POST", body: JSON.stringify({ cep: "58000-001" }) }), env, {});
        expect(await resposta.json()).toEqual({ distanciaKm: 5.2, taxa: 700 });
    });

    it("POST /api/entrega recusa CEP incompleto e avisa quando não entrega", async () => {
        const curto = await worker.fetch(new Request("https://flavorgrill.test/api/entrega", { method: "POST", body: JSON.stringify({ cep: "5800" }) }), env, {});
        expect(curto.status).toBe(400);
        simularFetch([["viacep.com.br", { erro: true }]]);
        const longe = await worker.fetch(new Request("https://flavorgrill.test/api/entrega", { method: "POST", body: JSON.stringify({ cep: "99999999" }) }), env, {});
        expect(longe.status).toBe(422);
        expect((await longe.json()).erro).toBe("entrega_indisponivel");
    });
});
