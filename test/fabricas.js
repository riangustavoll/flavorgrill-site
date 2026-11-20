// Cria pedidos direto no banco para os testes
import { env } from "cloudflare:workers";

export async function inserirPedido({
    codigo, status = "aguardando_pagamento", whatsapp = "83999998888", cupom = null,
    criadoEm = Date.now(), expiraEm = criadoEm + 17 * 60000, pagoEm = null, total = 5000, itens = []
}) {
    await env.DB.prepare(
        `INSERT INTO pedidos (codigo, status, criado_em, expira_em, pago_em, cliente_nome, cliente_whatsapp, endereco_json, itens_json,
         cupom_codigo, subtotal, desconto, entrega, total, atualizado_em)
         VALUES (?, ?, ?, ?, ?, 'Ana', ?, '{"cep":"58000000","rua":"Rua A","numero":"10","bairro":"Centro"}', ?, ?, ?, 0, 0, ?, ?)`
    ).bind(codigo, status, criadoEm, expiraEm, pagoEm, whatsapp, JSON.stringify(itens), cupom, total, total, criadoEm).run();
}
