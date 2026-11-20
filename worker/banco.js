// Funções simples de acesso ao banco (Cloudflare D1).

export const MINUTO = 60 * 1000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

export function agora() {
    return Date.now();
}

export async function lerConfig(env, chave) {
    const linha = await env.DB.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
    return linha ? linha.valor : null;
}

export async function gravarConfig(env, chave, valor) {
    await env.DB.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor")
        .bind(chave, String(valor)).run();
}

// Apaga pedidos não pagos com mais de 7 dias e pedidos com mais de 12 meses.
// Roda no máximo uma vez por hora (sem precisar de agendamento).
export async function limparAntigos(env) {
    const momento = agora();
    const ultima = Number(await lerConfig(env, "ultima_limpeza") || 0);
    if (momento - ultima < HORA) {
        return;
    }
    await gravarConfig(env, "ultima_limpeza", momento);
    await env.DB.batch([
        env.DB.prepare("DELETE FROM pedidos WHERE pago_em IS NULL AND criado_em < ?").bind(momento - 7 * DIA),
        env.DB.prepare("DELETE FROM pedidos WHERE criado_em < ?").bind(momento - 365 * DIA)
    ]);
}
