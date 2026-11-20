// Servidor da The Flavor Grill: atende a API (/api/...) e entrega o site estático (pasta public/).

import { json } from "./respostas.js";
import { rotaEntrega } from "./entrega.js";
import { rotaVerificarCupom } from "./cupons.js";
import { rotaLoja, rotaCriarPedido } from "./rotas-pedido.js";
import { rotaWebhook, rotaStatusPedido } from "./rotas-pagamento.js";
import { registrarRotasPainel } from "./rotas-painel.js";

export { json };

const rotas = [];

// Registra uma rota. O caminho aceita parâmetros, como "/api/pedidos/:codigo".
export function rota(metodo, caminho, handler) {
    const nomes = [];
    const padrao = new RegExp("^" + caminho.replace(/:([a-z_]+)/gi, (_, nome) => {
        nomes.push(nome);
        return "([^/]+)";
    }) + "/?$");
    rotas.push({ metodo, padrao, nomes, handler });
}


rota("GET", "/api/saude", () => json({ ok: true }));
rota("POST", "/api/entrega", rotaEntrega);
rota("POST", "/api/cupons/verificar", rotaVerificarCupom);
rota("GET", "/api/loja", rotaLoja);
rota("POST", "/api/pedidos", rotaCriarPedido);
rota("GET", "/api/pedidos/:codigo", rotaStatusPedido);
rota("POST", "/api/infinitepay/webhook", rotaWebhook);
registrarRotasPainel(rota);

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/")) {
            const candidatas = rotas.filter(r => r.padrao.test(url.pathname));
            const escolhida = candidatas.find(r => r.metodo === request.method);
            if (!escolhida) {
                return json({ erro: candidatas.length ? "metodo_nao_permitido" : "nao_encontrado" }, candidatas.length ? 405 : 404);
            }
            const valores = url.pathname.match(escolhida.padrao).slice(1);
            const params = Object.fromEntries(escolhida.nomes.map((nome, i) => [nome, decodeURIComponent(valores[i])]));
            try {
                return await escolhida.handler(request, env, ctx, params);
            } catch (erro) {
                console.error(erro);
                return json({ erro: "erro_interno", mensagem: "Algo deu errado. Tente de novo em instantes." }, 500);
            }
        }
        return env.ASSETS.fetch(request);
    }
};
