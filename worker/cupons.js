// Cupons validados no servidor. O desconto que vale é sempre o calculado aqui.
import { agora } from "./banco.js";
import { json, reais } from "./respostas.js";
import { somenteNumeros } from "./entrega.js";

// Status de pedido que contam como compra feita
export const STATUS_PAGOS = ["pago", "em_preparo", "saiu_para_entrega", "entregue"];
const LISTA_PAGOS = STATUS_PAGOS.map(s => "'" + s + "'").join(", ");

export function normalizarCodigo(codigo) {
    return String(codigo || "").toUpperCase().replace(/\s+/g, "");
}

function recusa(motivo, mensagem) {
    return { ok: false, motivo, mensagem };
}

export async function avaliarCupom(env, codigoDigitado, { whatsapp, subtotal, ignorarPedido = null }) {
    const codigo = normalizarCodigo(codigoDigitado);
    const cupom = await env.DB.prepare("SELECT * FROM cupons WHERE codigo = ?").bind(codigo).first();
    if (!cupom) {
        return recusa("inexistente", "Cupom não encontrado. Confira se digitou certinho.");
    }
    if (!cupom.ativo) {
        return recusa("inativo", "Esse cupom não está valendo no momento.");
    }
    if (cupom.valido_ate && cupom.valido_ate < agora()) {
        return recusa("vencido", "Esse cupom já venceu.");
    }
    if (cupom.limite_usos) {
        const usos = await env.DB.prepare(`SELECT COUNT(*) AS total FROM pedidos WHERE cupom_codigo = ? AND status IN (${LISTA_PAGOS})`).bind(codigo).first();
        if (usos.total >= cupom.limite_usos) {
            return recusa("esgotado", "Esse cupom já atingiu o limite de usos.");
        }
    }
    if (subtotal < cupom.minimo) {
        return recusa("minimo", "O cupom " + codigo + " vale para pedidos a partir de " + reais(cupom.minimo) + " em produtos (sem contar a entrega).");
    }
    if (cupom.primeira_compra) {
        const jaComprou = await env.DB.prepare(`SELECT 1 FROM pedidos WHERE cliente_whatsapp = ? AND status IN (${LISTA_PAGOS}) LIMIT 1`).bind(whatsapp).first();
        if (jaComprou) {
            return recusa("primeira_compra", "O cupom " + codigo + " vale só na primeira compra.");
        }
        const emUso = await env.DB.prepare(
            "SELECT 1 FROM pedidos WHERE cliente_whatsapp = ? AND cupom_codigo = ? AND status = 'aguardando_pagamento' AND expira_em > ? AND codigo IS NOT ? LIMIT 1"
        ).bind(whatsapp, codigo, agora(), ignorarPedido).first();
        if (emUso) {
            return recusa("em_uso", "Você já tem um pedido aguardando pagamento com o cupom " + codigo + ".");
        }
    }
    const desconto = cupom.tipo === "porcentagem"
        ? Math.floor(subtotal * cupom.valor / 100)
        : Math.min(cupom.valor, subtotal);
    return { ok: true, codigo, desconto };
}

// POST /api/cupons/verificar { codigo, whatsapp, subtotal } — só para o site mostrar o desconto
export async function rotaVerificarCupom(request, env) {
    const corpo = await request.json().catch(() => ({}));
    const subtotal = Number.isInteger(corpo.subtotal) && corpo.subtotal >= 0 ? corpo.subtotal : 0;
    return json(await avaliarCupom(env, corpo.codigo, { whatsapp: somenteNumeros(corpo.whatsapp), subtotal }));
}
