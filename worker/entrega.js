// Distância e taxa de entrega calculadas no servidor a partir do CEP.
// Política do Nominatim (OpenStreetMap): no máximo 1 consulta por segundo, identificação
// clara do aplicativo e resultados guardados para não repetir consultas.
// https://operations.osmfoundation.org/policies/nominatim/
import dados from "../public/js/dados.js";
import { agora, lerConfig, gravarConfig, DIA } from "./banco.js";
import { json } from "./respostas.js";

export const USER_AGENT = "TheFlavorGrill/1.0 (+https://flavorgrill.com.br)";
const VALIDADE_CACHE = 90 * DIA;
const TIPOS_DE_BAIRRO = ["suburb", "neighbourhood", "quarter", "city_district"];

function distanciaKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function buscarJson(url, cabecalhos = {}) {
    const resposta = await fetch(url, { headers: cabecalhos });
    if (!resposta.ok) {
        throw new Error("Falha ao consultar " + url);
    }
    return resposta.json();
}

// Espera o tempo que faltar para completar 1,1 s desde a última consulta ao mapa
async function esperarVezDoMapa(env) {
    const ultima = Number(await lerConfig(env, "ultima_consulta_mapa") || 0);
    const espera = ultima + 1100 - agora();
    if (espera > 0) {
        await new Promise(resolver => setTimeout(resolver, espera));
    }
    await gravarConfig(env, "ultima_consulta_mapa", agora());
}

async function consultarMapa(env, parametros) {
    await esperarVezDoMapa(env);
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=5&" + new URLSearchParams(parametros);
    return buscarJson(url, { "User-Agent": USER_AGENT });
}

async function localizar(env, endereco) {
    if (endereco.rua) {
        const ruas = await consultarMapa(env, { street: endereco.rua, city: endereco.cidade, state: endereco.estado });
        if (ruas.length > 0) {
            return { lat: Number(ruas[0].lat), lon: Number(ruas[0].lon) };
        }
    }
    if (endereco.bairro) {
        const lugares = await consultarMapa(env, { q: endereco.bairro + ", " + endereco.cidade + ", " + endereco.uf });
        const bairro = lugares.find(lugar => TIPOS_DE_BAIRRO.includes(lugar.addresstype));
        if (bairro) {
            return { lat: Number(bairro.lat), lon: Number(bairro.lon) };
        }
    }
    return null;
}

// Distância em km (1 casa decimal) da loja até o CEP, ou null se não der para calcular
export async function distanciaDoCep(env, { cep, rua, bairro }) {
    const emCache = await env.DB.prepare("SELECT distancia_km FROM ceps WHERE cep = ? AND atualizado_em > ?")
        .bind(cep, agora() - VALIDADE_CACHE).first();
    if (emCache) {
        return emCache.distancia_km;
    }
    try {
        const viaCep = await buscarJson("https://viacep.com.br/ws/" + cep + "/json/");
        if (viaCep.erro) {
            return null;
        }
        const ponto = await localizar(env, {
            rua: viaCep.logradouro || rua,
            bairro: viaCep.bairro || bairro,
            cidade: viaCep.localidade,
            estado: viaCep.estado,
            uf: viaCep.uf
        });
        if (!ponto) {
            return null;
        }
        const km = Math.round(distanciaKm(dados.LOJA, ponto) * 10) / 10;
        await env.DB.prepare("INSERT INTO ceps (cep, distancia_km, atualizado_em) VALUES (?, ?, ?) ON CONFLICT (cep) DO UPDATE SET distancia_km = excluded.distancia_km, atualizado_em = excluded.atualizado_em")
            .bind(cep, km, agora()).run();
        return km;
    } catch (erro) {
        console.error("Entrega:", erro.message);
        return null;
    }
}

export function taxaEntrega(distanciaKm) {
    return Math.round(dados.taxaPorDistancia(distanciaKm) * 100);
}

export function somenteNumeros(texto) {
    return String(texto || "").replace(/\D/g, "");
}

// POST /api/entrega { cep, rua?, bairro? }
export async function rotaEntrega(request, env) {
    const corpo = await request.json().catch(() => ({}));
    const cep = somenteNumeros(corpo.cep);
    if (cep.length !== 8) {
        return json({ erro: "cep_invalido", mensagem: "Informe o CEP com 8 números." }, 400);
    }
    const distanciaKm = await distanciaDoCep(env, { cep, rua: corpo.rua, bairro: corpo.bairro });
    if (distanciaKm === null) {
        return json({ erro: "entrega_indisponivel", mensagem: "Não conseguimos calcular a entrega para esse endereço." }, 422);
    }
    return json({ distanciaKm, taxa: taxaEntrega(distanciaKm) });
}
