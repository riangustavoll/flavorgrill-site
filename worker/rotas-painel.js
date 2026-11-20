// API do painel (protegida pelo Cloudflare Access + papel de cada e-mail).
import { agora, gravarConfig, DIA, HORA } from "./banco.js";
import { json } from "./respostas.js";
import { exigir } from "./acesso.js";
import { lojaAberta } from "./rotas-pedido.js";
import { STATUS_PAGOS, normalizarCodigo } from "./cupons.js";

const PROXIMO_STATUS = { pago: "em_preparo", em_preparo: "saiu_para_entrega", saiu_para_entrega: "entregue" };
const LISTA_PAGOS = STATUS_PAGOS.map(s => "'" + s + "'").join(", ");

const corpoJson = request => request.json().catch(() => ({}));

function cartaoPedido(linha) {
    return {
        codigo: linha.codigo,
        status: linha.status,
        pagoEm: linha.pago_em,
        cliente: { nome: linha.cliente_nome, whatsapp: linha.cliente_whatsapp },
        endereco: JSON.parse(linha.endereco_json),
        itens: JSON.parse(linha.itens_json),
        observacoes: linha.observacoes || "",
        cupom: linha.cupom_codigo,
        subtotal: linha.subtotal,
        desconto: linha.desconto,
        entrega: linha.entrega,
        total: linha.total,
        metodo: linha.metodo,
        alerta: linha.alerta
    };
}

async function listarPedidos(request, env) {
    const { results } = await env.DB.prepare(
        `SELECT * FROM pedidos
         WHERE status IN ('pago', 'em_preparo', 'saiu_para_entrega')
            OR (status IN ('entregue', 'cancelado') AND pago_em IS NOT NULL AND atualizado_em > ?)
         ORDER BY pago_em ASC`
    ).bind(agora() - 12 * HORA).all();
    return json({ pedidos: results.map(cartaoPedido) });
}

async function mudarStatus(request, env, ctx, { codigo }) {
    const { status } = await corpoJson(request);
    const pedido = await env.DB.prepare("SELECT status FROM pedidos WHERE codigo = ?").bind(codigo).first();
    if (!pedido) {
        return json({ erro: "nao_encontrado" }, 404);
    }
    if (PROXIMO_STATUS[pedido.status] !== status) {
        return json({ erro: "status_invalido", mensagem: "Esse pedido não pode ir para essa etapa." }, 409);
    }
    await env.DB.prepare("UPDATE pedidos SET status = ?, atualizado_em = ? WHERE codigo = ?").bind(status, agora(), codigo).run();
    return json({ codigo, status });
}

async function cancelar(request, env, ctx, { codigo }) {
    const pedido = await env.DB.prepare("SELECT status FROM pedidos WHERE codigo = ?").bind(codigo).first();
    if (!pedido) {
        return json({ erro: "nao_encontrado" }, 404);
    }
    await env.DB.prepare("UPDATE pedidos SET status = 'cancelado', atualizado_em = ? WHERE codigo = ?").bind(agora(), codigo).run();
    return json({ codigo, status: "cancelado", mensagem: "Pedido cancelado. Lembre de estornar o pagamento no app da InfinitePay." });
}

async function lerLoja(request, env) {
    return json({ aberta: await lojaAberta(env) });
}

async function mudarLoja(request, env) {
    const { aberta } = await corpoJson(request);
    await gravarConfig(env, "loja_aberta", aberta ? "1" : "0");
    return json({ aberta: Boolean(aberta) });
}

async function listarCupons(request, env) {
    const { results } = await env.DB.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM pedidos p WHERE p.cupom_codigo = c.codigo AND p.status IN (${LISTA_PAGOS})) AS usos
         FROM cupons c ORDER BY c.codigo`
    ).all();
    return json({
        cupons: results.map(c => ({
            codigo: c.codigo, tipo: c.tipo, valor: c.valor, minimo: c.minimo,
            primeiraCompra: Boolean(c.primeira_compra), ativo: Boolean(c.ativo),
            validoAte: c.valido_ate, limiteUsos: c.limite_usos, usos: c.usos
        }))
    });
}

async function salvarCupom(request, env) {
    const corpo = await corpoJson(request);
    const codigo = normalizarCodigo(corpo.codigo);
    const valor = Number(corpo.valor);
    const minimo = Number(corpo.minimo || 0);
    const limite = corpo.limiteUsos === null || corpo.limiteUsos === undefined || corpo.limiteUsos === "" ? null : Number(corpo.limiteUsos);
    const validoAte = corpo.validoAte ? Number(corpo.validoAte) : null;
    const valido = /^[A-Z0-9]{3,20}$/.test(codigo)
        && ["porcentagem", "fixo"].includes(corpo.tipo)
        && Number.isInteger(valor) && valor >= 1 && (corpo.tipo === "fixo" || valor <= 100)
        && Number.isInteger(minimo) && minimo >= 0
        && (limite === null || (Number.isInteger(limite) && limite >= 1));
    if (!valido) {
        return json({ erro: "cupom_invalido", mensagem: "Confira o código (3 a 20 letras ou números), o tipo e o valor." }, 400);
    }
    await env.DB.prepare(
        `INSERT INTO cupons (codigo, tipo, valor, minimo, primeira_compra, ativo, valido_ate, limite_usos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (codigo) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, minimo = excluded.minimo,
           primeira_compra = excluded.primeira_compra, ativo = excluded.ativo, valido_ate = excluded.valido_ate, limite_usos = excluded.limite_usos`
    ).bind(codigo, corpo.tipo, valor, minimo, corpo.primeiraCompra ? 1 : 0, corpo.ativo === false ? 0 : 1, validoAte, limite).run();
    return json({ ok: true, codigo });
}

// Início do dia em João Pessoa (UTC-3), em ms
function inicioDoDia(momento) {
    const TRES_HORAS = 3 * HORA;
    return Math.floor((momento - TRES_HORAS) / DIA) * DIA + TRES_HORAS;
}

async function totaisDesde(env, desde) {
    const linha = await env.DB.prepare(
        `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS vendas FROM pedidos
         WHERE pago_em >= ? AND status IN (${LISTA_PAGOS})`
    ).bind(desde).first();
    return { pedidos: linha.pedidos, vendas: linha.vendas, ticketMedio: linha.pedidos ? Math.round(linha.vendas / linha.pedidos) : 0 };
}

async function resumo(request, env) {
    const hoje = inicioDoDia(agora());
    return json({ hoje: await totaisDesde(env, hoje), semana: await totaisDesde(env, hoje - 6 * DIA) });
}

async function listarEquipe(request, env) {
    const { results } = await env.DB.prepare("SELECT email, papel FROM equipe ORDER BY email").all();
    const dono = (env.DONO_EMAIL || "").toLowerCase();
    return json({ equipe: [{ email: dono, papel: "dono", fixo: true }, ...results.filter(m => m.email !== dono)] });
}

async function adicionarEquipe(request, env) {
    const corpo = await corpoJson(request);
    const email = String(corpo.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["dono", "equipe"].includes(corpo.papel)) {
        return json({ erro: "email_invalido", mensagem: "Confira o e-mail." }, 400);
    }
    await env.DB.prepare("INSERT INTO equipe (email, papel, criado_em) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET papel = excluded.papel")
        .bind(email, corpo.papel, agora()).run();
    return json({ ok: true, email, papel: corpo.papel });
}

async function removerEquipe(request, env) {
    const email = String((await corpoJson(request)).email || "").trim().toLowerCase();
    if (email === (env.DONO_EMAIL || "").toLowerCase()) {
        return json({ erro: "dono_fixo", mensagem: "O e-mail do dono não pode ser removido." }, 400);
    }
    await env.DB.prepare("DELETE FROM equipe WHERE email = ?").bind(email).run();
    return json({ ok: true });
}

export function registrarRotasPainel(rota) {
    rota("GET", "/api/painel/eu", exigir("equipe", (request, env, ctx, params, usuario) => json(usuario)));
    rota("GET", "/api/painel/pedidos", exigir("equipe", listarPedidos));
    rota("POST", "/api/painel/pedidos/:codigo/status", exigir("equipe", mudarStatus));
    rota("POST", "/api/painel/pedidos/:codigo/cancelar", exigir("dono", cancelar));
    rota("GET", "/api/painel/loja", exigir("equipe", lerLoja));
    rota("POST", "/api/painel/loja", exigir("equipe", mudarLoja));
    rota("GET", "/api/painel/cupons", exigir("dono", listarCupons));
    rota("POST", "/api/painel/cupons", exigir("dono", salvarCupom));
    rota("GET", "/api/painel/resumo", exigir("dono", resumo));
    rota("GET", "/api/painel/equipe", exigir("dono", listarEquipe));
    rota("POST", "/api/painel/equipe", exigir("dono", adicionarEquipe));
    rota("DELETE", "/api/painel/equipe", exigir("dono", removerEquipe));
}
