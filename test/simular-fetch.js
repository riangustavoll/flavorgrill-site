// Simula a internet nos testes: cada regra responde às URLs que contêm um trecho.
import { vi } from "vitest";

export function simularFetch(regras) {
    const chamadas = [];
    const espiao = vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, opcoes = {}) => {
        const pedido = new Request(entrada, opcoes);
        const corpo = pedido.method === "GET" ? null : await pedido.clone().text();
        chamadas.push({ url: pedido.url, metodo: pedido.method, cabecalhos: pedido.headers, corpo: corpo ? JSON.parse(corpo) : null });
        for (const [trecho, resposta] of regras) {
            if (pedido.url.includes(trecho)) {
                const valor = typeof resposta === "function" ? await resposta(pedido, corpo ? JSON.parse(corpo) : null) : resposta;
                if (valor instanceof Response) return valor;
                return new Response(JSON.stringify(valor), { status: 200, headers: { "content-type": "application/json" } });
            }
        }
        throw new Error("Sem regra para " + pedido.url);
    });
    return { chamadas, espiao };
}
