// Gera tokens do Cloudflare Access assinados por uma chave de teste
import { simularFetch } from "./simular-fetch.js";

const b64url = dados => btoa(typeof dados === "string" ? dados : String.fromCharCode(...new Uint8Array(dados)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function criarChave(kid) {
    const par = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"]
    );
    const publica = await crypto.subtle.exportKey("jwk", par.publicKey);
    return { kid, privada: par.privateKey, jwk: { ...publica, kid, alg: "RS256", use: "sig" } };
}

export async function assinar(chave, dados) {
    const cabecalho = b64url(JSON.stringify({ alg: "RS256", kid: chave.kid, typ: "JWT" }));
    const corpo = b64url(JSON.stringify(dados));
    const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave.privada, new TextEncoder().encode(cabecalho + "." + corpo));
    return cabecalho + "." + corpo + "." + b64url(assinatura);
}

export function servirChaves(...chaves) {
    return simularFetch([["/cdn-cgi/access/certs", { keys: chaves.map(c => c.jwk) }]]);
}

export function dadosToken(email, extra = {}) {
    return {
        email,
        aud: ["aud-teste"],
        iss: "https://flavorgrill.cloudflareaccess.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...extra
    };
}
