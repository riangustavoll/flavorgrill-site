// Criação de pedidos (POST /api/pedidos) e estado da loja (GET /api/loja).
import { agora, lerConfig, limparAntigos, MINUTO } from "./banco.js";
import { json } from "./respostas.js";
import { calcularItens, ErroPedido } from "./pedido.js";
import { distanciaDoCep, taxaEntrega, somenteNumeros } from "./entrega.js";
import { avaliarCupom, normalizarCodigo } from "./cupons.js";
import { criarLink } from "./infinitepay.js";

export const VALIDADE_PEDIDO = 17 * MINUTO;
const LIMITE_PENDENTES = 3;
const LETRAS_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function lojaAberta(env) {
    return (await lerConfig(env, "loja_aberta")) === "1";
}

export async function rotaLoja(request, env) {
    return json({ aberta: await lojaAberta(env) });
}

function texto(valor, maximo) {
    return typeof valor === "string" ? valor.trim().slice(0, maximo) : "";
}

function lerCliente(corpo) {
    const cliente = corpo.cliente || {};
    const endereco = corpo.endereco || {};
    const dados = {
        cliente: { nome: texto(cliente.nome, 60), whatsapp: somenteNumeros(cliente.whatsapp) },
        endereco: {
            cep: somenteNumeros(endereco.cep),
            rua: texto(endereco.rua, 120),
            numero: texto(endereco.numero, 20),
            bairro: texto(endereco.bairro, 80),
            referencia: texto(endereco.referencia, 120)
        },
        observacoes: texto(corpo.observacoes, 300)
    };
    const valido = dados.cliente.nome.length >= 2
        && [10, 11].includes(dados.cliente.whatsapp.length)
        && dados.endereco.cep.length === 8
        && dados.endereco.rua && dados.endereco.numero && dados.endereco.bairro;
    return valido ? dados : null;
}

function sortearCodigo() {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return "FG" + Array.from(bytes, b => LETRAS_CODIGO[b % LETRAS_CODIGO.length]).join("");
}

async function codigoNovo(env) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
        const codigo = sortearCodigo();
        if (!await env.DB.prepare("SELECT 1 FROM pedidos WHERE codigo = ?").bind(codigo).first()) {
            return codigo;
        }
    }
    throw new Error("Não foi possível gerar um código de pedido");
}

export async function rotaCriarPedido(request, env, ctx) {
    ctx.waitUntil(limparAntigos(env).catch(erro => console.error("Limpeza:", erro)));
    if (!await lojaAberta(env)) {
        return json({ erro: "loja_fechada", mensagem: "Estamos fechados agora. Volte mais tarde!" }, 409);
    }
    const corpo = await request.json().catch(() => ({}));
    const dados = lerCliente(corpo);
    if (!dados) {
        return json({ erro: "dados_invalidos", mensagem: "Confira seu nome, WhatsApp e endereço." }, 400);
    }

    let calculo;
    try {
        calculo = calcularItens(corpo.itens);
    } catch (erro) {
        if (erro instanceof ErroPedido) {
            return json({ erro: erro.codigo, mensagem: erro.message }, 400);
        }
        throw erro;
    }

    let entrega = 0;
    let distanciaKm = null;
    if (!calculo.temCombo) {
        distanciaKm = await distanciaDoCep(env, dados.endereco);
        if (distanciaKm === null) {
            return json({ erro: "entrega_indisponivel", mensagem: "Não conseguimos calcular a entrega para esse endereço. Peça pelo WhatsApp." }, 422);
        }
        entrega = taxaEntrega(distanciaKm);
    }

    const momento = agora();
    const pendentes = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM pedidos WHERE cliente_whatsapp = ? AND status = 'aguardando_pagamento' AND expira_em > ?"
    ).bind(dados.cliente.whatsapp, momento).first();
    if (pendentes.total >= LIMITE_PENDENTES) {
        return json({ erro: "muitos_pedidos", mensagem: "Você já tem pedidos aguardando pagamento. Pague um deles ou espere alguns minutos." }, 429);
    }

    let desconto = 0;
    let cupom = null;
    if (normalizarCodigo(corpo.cupom)) {
        const avaliacao = await avaliarCupom(env, corpo.cupom, { whatsapp: dados.cliente.whatsapp, subtotal: calculo.subtotal });
        if (!avaliacao.ok) {
            return json({ erro: avaliacao.motivo, mensagem: avaliacao.mensagem }, 422);
        }
        desconto = avaliacao.desconto;
        cupom = avaliacao.codigo;
    }

    const total = calculo.subtotal - desconto + entrega;
    if (total < 100) {
        return json({ erro: "valor_minimo", mensagem: "O pedido precisa ser de pelo menos R$ 1,00." }, 422);
    }

    const codigo = await codigoNovo(env);
    const pedido = { codigo, total, expiraEm: momento + VALIDADE_PEDIDO, ...dados };
    await env.DB.prepare(
        `INSERT INTO pedidos (codigo, status, criado_em, expira_em, cliente_nome, cliente_whatsapp, endereco_json, itens_json,
         observacoes, cupom_codigo, subtotal, desconto, entrega, total, distancia_km, atualizado_em)
         VALUES (?, 'aguardando_pagamento', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(codigo, momento, pedido.expiraEm, dados.cliente.nome, dados.cliente.whatsapp, JSON.stringify(dados.endereco),
        JSON.stringify(calculo.itens), dados.observacoes, cupom, calculo.subtotal, desconto, entrega, total, distanciaKm, momento).run();

    let url;
    try {
        url = await criarLink(env, pedido);
    } catch (erro) {
        console.error("Link de pagamento:", erro.message);
        await env.DB.prepare("DELETE FROM pedidos WHERE codigo = ?").bind(codigo).run();
        return json({ erro: "pagamento_indisponivel", mensagem: "Não conseguimos abrir o pagamento agora. Tente de novo em instantes." }, 502);
    }
    await env.DB.prepare("UPDATE pedidos SET link_url = ? WHERE codigo = ?").bind(url, codigo).run();
    return json({ codigo, url }, 201);
}
