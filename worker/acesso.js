// Quem está usando o painel. O login (e-mail + código) é feito pelo Cloudflare Access,
// que manda um token assinado (JWT) em cada requisição. Aqui conferimos a assinatura e
// buscamos o papel do e-mail: DONO_EMAIL é sempre dono; os demais vêm da tabela "equipe".
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
import { json } from "./respostas.js";

const HIERARQUIA = { equipe: 1, dono: 2 };
let chavesEmCache = { dominio: null, chaves: [], ate: 0 };

function decodificarBase64Url(texto) {
    const base64 = texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4);
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function chavesPublicas(dominio, forcar = false) {
    if (!forcar && chavesEmCache.dominio === dominio && chavesEmCache.ate > Date.now()) {
        return chavesEmCache.chaves;
    }
    const resposta = await fetch("https://" + dominio + "/cdn-cgi/access/certs");
    const { keys = [] } = await resposta.json();
    chavesEmCache = { dominio, chaves: keys, ate: Date.now() + 60 * 60 * 1000 };
    return keys;
}

async function validarToken(token, env) {
    const partes = String(token || "").split(".");
    if (partes.length !== 3 || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
        return null;
    }
    try {
        const cabecalho = JSON.parse(new TextDecoder().decode(decodificarBase64Url(partes[0])));
        const dados = JSON.parse(new TextDecoder().decode(decodificarBase64Url(partes[1])));
        if (cabecalho.alg !== "RS256") return null;
        let jwk = (await chavesPublicas(env.ACCESS_TEAM_DOMAIN)).find(k => k.kid === cabecalho.kid);
        if (!jwk) {
            jwk = (await chavesPublicas(env.ACCESS_TEAM_DOMAIN, true)).find(k => k.kid === cabecalho.kid);
        }
        if (!jwk) return null;
        const chave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        const valido = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, decodificarBase64Url(partes[2]),
            new TextEncoder().encode(partes[0] + "." + partes[1]));
        const audiencias = Array.isArray(dados.aud) ? dados.aud : [dados.aud];
        if (!valido
            || !audiencias.includes(env.ACCESS_AUD)
            || dados.iss !== "https://" + env.ACCESS_TEAM_DOMAIN
            || !(dados.exp * 1000 > Date.now())
            || typeof dados.email !== "string") {
            return null;
        }
        return dados.email.toLowerCase();
    } catch (erro) {
        return null;
    }
}

function emailDeDesenvolvimento(request, env) {
    const host = new URL(request.url).hostname;
    if (env.AMBIENTE === "dev" && env.ACESSO_DEV_EMAIL && (host === "localhost" || host === "127.0.0.1")) {
        return env.ACESSO_DEV_EMAIL.toLowerCase();
    }
    return null;
}

function lerCookie(request, nome) {
    const cookies = request.headers.get("Cookie") || "";
    const achado = cookies.split(";").map(c => c.trim()).find(c => c.startsWith(nome + "="));
    return achado ? achado.slice(nome.length + 1) : null;
}

export async function identificar(request, env) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion") || lerCookie(request, "CF_Authorization");
    const email = emailDeDesenvolvimento(request, env) || await validarToken(token, env);
    if (!email) {
        return null;
    }
    if (env.DONO_EMAIL && email === env.DONO_EMAIL.toLowerCase()) {
        return { email, papel: "dono" };
    }
    const membro = await env.DB.prepare("SELECT papel FROM equipe WHERE email = ?").bind(email).first();
    return membro ? { email, papel: membro.papel } : null;
}

// Envolve um handler do painel: exige login e o papel mínimo ("equipe" ou "dono")
export function exigir(papelMinimo, handler) {
    return async (request, env, ctx, params) => {
        const usuario = await identificar(request, env);
        if (!usuario) {
            return json({ erro: "sem_acesso", mensagem: "Seu e-mail não tem acesso. Peça ao dono para adicionar." }, 401);
        }
        if (HIERARQUIA[usuario.papel] < HIERARQUIA[papelMinimo]) {
            return json({ erro: "so_dono", mensagem: "Só o dono pode fazer isso." }, 403);
        }
        return handler(request, env, ctx, params, usuario);
    };
}
