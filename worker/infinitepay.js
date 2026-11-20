// Comunicação com o Checkout Integrado da InfinitePay.
// Documentação: https://www.infinitepay.io/checkout-documentacao

export class ErroPagamento extends Error {}

// Data em ISO 8601 no horário de Brasília (UTC-3), ex.: 2026-11-19T18:00:00-03:00
export function validoAte(ms) {
    return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 19) + "-03:00";
}

async function chamar(env, caminho, corpo) {
    const cabecalhos = { "content-type": "application/json" };
    if (env.INFINITEPAY_API_KEY) {
        cabecalhos["X-Api-Key"] = env.INFINITEPAY_API_KEY;
    }
    let resposta;
    try {
        resposta = await fetch(env.INFINITEPAY_BASE + caminho, { method: "POST", headers: cabecalhos, body: JSON.stringify(corpo) });
    } catch (erro) {
        throw new ErroPagamento("Sem conexão com a InfinitePay: " + erro.message);
    }
    return resposta;
}

// Cria o link de pagamento e devolve a URL para onde o cliente vai.
// Vai um item só com o total: a InfinitePay não aceita desconto como item negativo.
export async function criarLink(env, pedido) {
    const corpo = {
        handle: env.INFINITEPAY_HANDLE,
        items: [{ quantity: 1, price: pedido.total, description: "Pedido " + pedido.codigo + " — The Flavor Grill" }],
        order_nsu: pedido.codigo,
        redirect_url: env.SITE_URL + "/?pedido=" + pedido.codigo,
        webhook_url: env.SITE_URL + "/api/infinitepay/webhook",
        customer: { name: pedido.cliente.nome, phone_number: "+55" + pedido.cliente.whatsapp },
        address: {
            cep: pedido.endereco.cep,
            street: pedido.endereco.rua,
            number: pedido.endereco.numero,
            neighborhood: pedido.endereco.bairro,
            city: "João Pessoa",
            state: "PB",
            complement: pedido.endereco.referencia || ""
        }
    };
    if (env.INFINITEPAY_API_KEY) {
        corpo.options = { valid_until: validoAte(pedido.expiraEm), assured_installments: 0, single_payment: true };
    }
    const resposta = await chamar(env, "/links", corpo);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.url) {
        throw new ErroPagamento("A InfinitePay não criou o link (HTTP " + resposta.status + ")");
    }
    return dados.url;
}

// Pergunta à InfinitePay se o pedido foi pago. Só esta resposta transforma um pedido em "pago".
export async function conferirPagamento(env, { codigo, transacaoNsu, slug }) {
    const resposta = await chamar(env, "/payment_check", {
        handle: env.INFINITEPAY_HANDLE,
        order_nsu: codigo,
        transaction_nsu: transacaoNsu,
        slug
    });
    if (resposta.status >= 500) {
        throw new ErroPagamento("InfinitePay indisponível (HTTP " + resposta.status + ")");
    }
    const dados = await resposta.json().catch(() => ({}));
    const pago = resposta.ok && dados.success === true && dados.paid === true;
    return {
        pago,
        valor: pago ? dados.amount : null,
        valorPago: pago ? dados.paid_amount : null,
        metodo: pago ? dados.capture_method || null : null
    };
}
