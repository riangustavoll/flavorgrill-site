// Recalcula a sacola no servidor com os preços do cardápio (public/js/dados.js).
// O navegador só manda ids, quantidades e escolhas; nunca preços. Valores em centavos.
import dados from "../public/js/dados.js";

export class ErroPedido extends Error {
    constructor(codigo, mensagem) {
        super(mensagem);
        this.codigo = codigo;
    }
}

const centavos = valor => Math.round(valor * 100);

function validarLinha(linha) {
    const item = dados.buscarItem(linha && linha.id);
    if (!item) {
        throw new ErroPedido("item_inexistente", "Um dos itens da sacola não está mais no cardápio.");
    }
    const quantidade = linha.quantidade;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
        throw new ErroPedido("quantidade_invalida", "Quantidade inválida para " + item.nome + ".");
    }
    const combo = Boolean(linha.combo);
    if (combo && !item.podeSerCombo) {
        throw new ErroPedido("combo_invalido", item.nome + " não pode virar combo.");
    }
    const adicionais = Array.isArray(linha.adicionais) ? linha.adicionais : [];
    const adicionaisValidos = adicionais.every(id => dados.buscarAdicional(id));
    if (adicionais.length && (!item.podeSerCombo || !adicionaisValidos || new Set(adicionais).size !== adicionais.length)) {
        throw new ErroPedido("adicional_invalido", "Adicional inválido em " + item.nome + ".");
    }
    let burguers = [];
    if (item.escolherBurguers) {
        burguers = Array.isArray(linha.burguers) ? linha.burguers : [];
        if (burguers.length !== item.escolherBurguers || !burguers.every(id => item.burguersPermitidos.includes(id))) {
            throw new ErroPedido("burguers_invalidos", "Escolha os burguers do " + item.nome + " de novo.");
        }
    }
    const observacao = typeof linha.observacao === "string" ? linha.observacao.trim().slice(0, 140) : "";
    return { item, quantidade, combo, adicionais, burguers, observacao };
}

function descrever({ item, quantidade, combo, adicionais, burguers }) {
    let texto = quantidade + "× " + item.nome + (combo ? " (combo)" : "");
    if (burguers.length) {
        texto += " · " + burguers.map(id => dados.buscarItem(id).nome).join(" + ");
    }
    if (adicionais.length) {
        texto += " · " + adicionais.map(id => dados.buscarAdicional(id).nome).join(", ");
    }
    return texto;
}

export function calcularItens(linhas) {
    if (!Array.isArray(linhas) || linhas.length === 0) {
        throw new ErroPedido("sacola_vazia", "Sua sacola está vazia.");
    }
    if (linhas.length > 30) {
        throw new ErroPedido("sacola_grande", "Sacola com itens demais. Fale com a gente pelo WhatsApp.");
    }
    const itens = linhas.map(validarLinha).map(linha => {
        const acrescimos = linha.burguers.reduce((total, id) => total + ((linha.item.acrescimosBurguer || {})[id] || 0), 0);
        const unitario = centavos(linha.item.preco)
            + (linha.combo ? centavos(dados.PRECO_COMBO) : 0)
            + linha.adicionais.reduce((total, id) => total + centavos(dados.buscarAdicional(id).preco), 0)
            + centavos(acrescimos);
        return {
            id: linha.item.id,
            nome: linha.item.nome,
            quantidade: linha.quantidade,
            unitario,
            combo: linha.combo,
            adicionais: linha.adicionais,
            burguers: linha.burguers,
            observacao: linha.observacao,
            descricao: descrever(linha),
            ehCombo: Boolean(linha.item.ehCombo)
        };
    });
    return {
        itens,
        subtotal: itens.reduce((total, item) => total + item.unitario * item.quantidade, 0),
        temCombo: itens.some(item => item.combo || item.ehCombo)
    };
}
