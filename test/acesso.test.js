import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { identificar } from "../worker/acesso.js";
import { criarChave, assinar, servirChaves, dadosToken } from "./access-falso.js";

let chave;
let outra;
beforeAll(async () => {
    chave = await criarChave("chave-1");
    outra = await criarChave("chave-2");
    await env.DB.prepare("INSERT OR REPLACE INTO equipe (email, papel, criado_em) VALUES ('ajudante@flavorgrill.test', 'equipe', 0)").run();
});
afterEach(() => vi.restoreAllMocks());

async function pedidoCom(token, url = "https://flavorgrill.test/api/painel/eu") {
    return new Request(url, { headers: { "Cf-Access-Jwt-Assertion": token } });
}

describe("identificação no painel", () => {
    it("reconhece o dono (DONO_EMAIL), sem diferenciar maiúsculas", async () => {
        servirChaves(chave);
        const token = await assinar(chave, dadosToken("Dono@FlavorGrill.test"));
        expect(await identificar(await pedidoCom(token), env)).toEqual({ email: "dono@flavorgrill.test", papel: "dono" });
    });

    it("reconhece quem está na equipe", async () => {
        servirChaves(chave);
        const token = await assinar(chave, dadosToken("ajudante@flavorgrill.test"));
        expect(await identificar(await pedidoCom(token), env)).toEqual({ email: "ajudante@flavorgrill.test", papel: "equipe" });
    });

    it("recusa e-mail que não está na equipe", async () => {
        servirChaves(chave);
        const token = await assinar(chave, dadosToken("estranho@gmail.com"));
        expect(await identificar(await pedidoCom(token), env)).toBeNull();
    });

    it("recusa token sem cabeçalho, de outra aplicação, de outra chave ou vencido", async () => {
        servirChaves(chave);
        expect(await identificar(new Request("https://flavorgrill.test/api/painel/eu"), env)).toBeNull();
        expect(await identificar(await pedidoCom(await assinar(chave, dadosToken("dono@flavorgrill.test", { aud: ["outra"] }))), env)).toBeNull();
        expect(await identificar(await pedidoCom(await assinar(outra, dadosToken("dono@flavorgrill.test"))), env)).toBeNull();
        expect(await identificar(await pedidoCom(await assinar(chave, dadosToken("dono@flavorgrill.test", { exp: 1000 }))), env)).toBeNull();
        expect(await identificar(await pedidoCom(await assinar(chave, dadosToken("dono@flavorgrill.test", { iss: "https://outro.cloudflareaccess.com" }))), env)).toBeNull();
        expect(await identificar(await pedidoCom("lixo.lixo.lixo"), env)).toBeNull();
    });

    it("e-mail de desenvolvimento só vale em ambiente dev e no localhost", async () => {
        const dev = { ...env, AMBIENTE: "dev", ACESSO_DEV_EMAIL: "dono@flavorgrill.test" };
        expect(await identificar(new Request("http://localhost:8787/api/painel/eu"), dev)).toEqual({ email: "dono@flavorgrill.test", papel: "dono" });
        expect(await identificar(new Request("https://flavorgrill.workers.dev/api/painel/eu"), dev)).toBeNull();
        expect(await identificar(new Request("http://localhost:8787/api/painel/eu"), { ...dev, AMBIENTE: "producao" })).toBeNull();
    });
});
