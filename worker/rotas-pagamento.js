// Confirmação de pagamento: o aviso da InfinitePay (webhook) não é assinado, então nunca
// é aceito sozinho. O pedido só vira "pago" quando o payment_check confirma.
import { agora } from "./banco.js";
import { json, reais } from "./respostas.js";
import { conferirPagamento, ErroPagamento } from "./infinitepay.js";
import { lojaAberta } from "./rotas-pedido.js";

export async function confirmarPedido(env, codigo, { transacaoNsu, slug, recibo = null }) {
    const pedido = await env.DB.prepare("SELECT * FROM pedidos WHERE codigo = ?").bind(codigo).first();
    if (!pedido) {
        return null;
    }
    if (pedido.status !== "aguardando_pagamento") {
        return pedido.status;
    }
    const resultado = await conferirPagamento(env, { codigo, transacaoNsu, slug });
    if (!resultado.pago) {
        return pedido.status;
    }
    const momento = agora();
    // Pago a menos (ex.: link criado por fora com o mesmo código): não vai para a cozinha.
    // O dinheiro aparece no app da InfinitePay e a loja resolve com o cliente.
    if (resultado.valor < pedido.total) {
        await env.DB.prepare("UPDATE pedidos SET alerta = ?, atualizado_em = ? WHERE codigo = ? AND status = 'aguardando_pagamento'")
            .bind("pagou " + reais(resultado.valor) + ", menos que o pedido", momento, codigo).run();
        console.error("Pagamento menor que o pedido:", codigo, resultado.valor, pedido.total);
        return pedido.status;
    }
    const alertas = [];
    if (resultado.valor !== pedido.total) alertas.push("valor diferente do pedido");
    if (momento > pedido.expira_em) alertas.push("pago depois de expirar");
    if (!await lojaAberta(env)) alertas.push("loja estava fechada");
    await env.DB.prepare(
        `UPDATE pedidos SET status = 'pago', pago_em = ?, valor_pago = ?, metodo = ?, transacao_nsu = ?, slug = ?,
         recibo_url = COALESCE(?, recibo_url), alerta = ?, atualizado_em = ? WHERE codigo = ? AND status = 'aguardando_pagamento'`
    ).bind(momento, resultado.valorPago, resultado.metodo, transacaoNsu, slug, recibo, alertas.length ? alertas.join(" · ") : null, momento, codigo).run();
    return "pago";
}

// POST /api/infinitepay/webhook
export async function rotaWebhook(request, env) {
    const aviso = await request.json().catch(() => ({}));
    if (typeof aviso.order_nsu !== "string") {
        return json({ ok: true });
    }
    try {
        await confirmarPedido(env, aviso.order_nsu, {
            transacaoNsu: aviso.transaction_nsu,
            slug: aviso.invoice_slug,
            recibo: aviso.receipt_url || null
        });
    } catch (erro) {
        if (erro instanceof ErroPagamento) {
            console.error("Webhook:", erro.message);
            return json({ erro: "tente_de_novo" }, 400);
        }
        throw erro;
    }
    return json({ ok: true });
}

// GET /api/pedidos/:codigo?transaction_nsu=&slug= — usado na volta do pagamento
export async function rotaStatusPedido(request, env, ctx, { codigo }) {
    const url = new URL(request.url);
    const transacaoNsu = url.searchParams.get("transaction_nsu");
    const slug = url.searchParams.get("slug");
    if (transacaoNsu && slug) {
        try {
            await confirmarPedido(env, codigo, { transacaoNsu, slug });
        } catch (erro) {
            if (!(erro instanceof ErroPagamento)) throw erro;
        }
    }
    const pedido = await env.DB.prepare("SELECT codigo, status, total, expira_em FROM pedidos WHERE codigo = ?").bind(codigo).first();
    if (!pedido) {
        return json({ erro: "nao_encontrado" }, 404);
    }
    const status = pedido.status === "aguardando_pagamento" && agora() > pedido.expira_em ? "expirado" : pedido.status;
    return json({ codigo: pedido.codigo, status, total: pedido.total });
}
