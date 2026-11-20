import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";
import dados from "../public/js/dados.js";

describe("estrutura do servidor", () => {
    it("responde /api/saude", async () => {
        const resposta = await exports.default.fetch("https://flavorgrill.test/api/saude");
        expect(resposta.status).toBe(200);
        expect(await resposta.json()).toEqual({ ok: true });
    });

    it("serve o site na raiz", async () => {
        const resposta = await exports.default.fetch("https://flavorgrill.test/");
        expect(resposta.status).toBe(200);
        expect(await resposta.text()).toContain("The Flavor Grill");
    });

    it("usa os mesmos dados do cardápio do site", () => {
        expect(dados.buscarItem("classico").preco).toBe(24.9);
        expect(dados.taxaPorDistancia(4)).toBe(7);
    });
});
