/*
  dados.js
  Configurações da loja e itens do cardápio.
  Para mudar preços, telefone ou itens, edite apenas este arquivo:
  o site e o servidor (worker/) usam os mesmos preços daqui.
*/

// Número no formato internacional, só dígitos: 55 (Brasil) + 83 (DDD) + número
const NUMERO_WHATSAPP = "5583998903631";

// Valor acrescentado quando o cliente transforma um burguer em combo (batata + refri lata)
const PRECO_COMBO = 20;

// Entrega: a taxa depende da distância (em linha reta) entre a loja e o CEP do cliente.
// Pedidos com combo têm entrega grátis.
const LOJA = { lat: -7.21453, lon: -34.84629 }; // Rua Alcides Ribeiro da Silva, Gramame

// A distância é calculada pelo servidor (worker/entrega.js), que consulta o OpenStreetMap
// seguindo as regras de uso: https://operations.osmfoundation.org/policies/nominatim/
const FAIXAS_ENTREGA = [
    { ateKm: 3, taxa: 5 },
    { ateKm: 6, taxa: 7 },
    { ateKm: 10, taxa: 10 },
    { ateKm: Infinity, taxa: 14 }
];

// Cupons de desconto: ficam no servidor e são criados ou pausados pelo painel (/painel).

// Chaves usadas para salvar dados no localStorage
const CHAVE_CARRINHO = "flavorgrill.carrinho";
const CHAVE_CLIENTE = "flavorgrill.cliente";

// Adicionais escolhidos dentro de cada burguer (aparecem na janela de personalização)
const ADICIONAIS = [
    { id: "blend-extra", nome: "Blend extra", preco: 10, descricao: "Mais 160g de carne suculenta na brasa: pra quem chega com fome de verdade." },
    { id: "cheddar", nome: "Cheddar cremoso", preco: 5, descricao: "Aquela camada extra de cheddar que escorre a cada mordida." },
    { id: "bacon-crocante", nome: "Bacon crocante", preco: 5, descricao: "Tiras de bacon bem sequinhas e crocantes por cima do seu burguer." },
    { id: "geleia-bacon", nome: "Geleia de bacon", preco: 3, descricao: "O toque que deixa qualquer burguer mais especial." }
];

const CATEGORIAS = [
    {
        id: "categoria-flavor",
        nome: "Menu Flavor",
        itens: [
            {
                id: "classico",
                nome: "F Clássico",
                preco: 24.90,
                podeSerCombo: true,
                descricao: "Burguer de 160g, brioche amanteigado, molho barbecue, cheddar cremoso, cebola caramelizada e maionese da casa."
            },
            {
                id: "salada",
                nome: "F Salada",
                preco: 26.90,
                podeSerCombo: true,
                descricao: "Burguer 160g, brioche amanteigado, molho barbecue, cheddar cremoso, picles artesanal, alface, tomate, cebola roxa e maionese da casa."
            },
            {
                id: "bacon",
                nome: "F Bacon",
                preco: 29.90,
                podeSerCombo: true,
                descricao: "Burguer 160g, brioche amanteigado, molho barbecue, bacon em tirinhas, cheddar cremoso, cebola caramelizada, maionese da casa e crispy de bacon."
            },
            {
                id: "prime",
                nome: "F Prime",
                preco: 39.90,
                podeSerCombo: true,
                etiqueta: "Duas carnes",
                descricao: "Duas carnes de 160g, brioche amanteigado, molho barbecue, cream cheese, crispy de bacon, cheddar cremoso, cebola caramelizada e maionese da casa."
            }
        ]
    },
    {
        id: "categoria-combos",
        nome: "Combos",
        itens: [
            {
                id: "combo-casal",
                nome: "Combo Casal",
                preco: 89.90,
                ehCombo: true,
                etiqueta: "Pra 2 pessoas",
                escolherBurguers: 2,
                burguersPermitidos: ["classico", "salada", "bacon", "prime"],
                // Valor somado ao combo para cada burguer escolhido que estiver aqui
                acrescimosBurguer: { prime: 12 },
                inclui: "+ Fritas GG + refri 1L",
                destaque: "2 burguers à sua escolha + Fritas GG + refri 1L",
                descricao: "Perfeito pra dividir a noite com quem você gosta."
            },
            {
                id: "combo-duplo-classico",
                nome: "Combo Duplo Clássico",
                preco: 79.90,
                ehCombo: true,
                etiqueta: "Mais em conta",
                inclui: "2 F Clássico + 2 batatas + 2 refri lata",
                destaque: "2 F Clássico + 2 batatas + 2 refri lata",
                descricao: "Dois combos clássicos completos por um preço menor."
            },
            {
                id: "combo-petisco",
                nome: "Combo Petisco",
                preco: 64.90,
                ehCombo: true,
                etiqueta: "Refri grátis",
                inclui: "Fritas GG + Iscas de Frango + refri 1L + maionese da casa e barbecue",
                destaque: "Fritas GG + Iscas de Frango + refri 1L",
                descricao: "As duas porções da casa com refri 1L de graça. Acompanha maionese da casa e barbecue."
            }
        ]
    },
    {
        id: "categoria-porcoes",
        nome: "Porções",
        temMolhoGratis: true,
        itens: [
            { id: "batata", nome: "Fritas GG", preco: 34.90, descricao: "300g de batatas fritas, cobertas com parmesão ralado, farofa de bacon e molho barbecue." },
            { id: "iscas", nome: "Iscas de Frango", preco: 34.90, descricao: "300g de iscas de frango empanadas e bem crocantes, servidas com molho barbecue." }
        ]
    },
    {
        id: "categoria-bebidas",
        nome: "Bebidas",
        itens: [
            { id: "coca-lata", nome: "Coca-Cola", preco: 9.90, descricao: "Lata de 350ml, bem gelada." },
            { id: "coca-zero-lata", nome: "Coca-Cola Zero", preco: 9.90, descricao: "Lata de 350ml, bem gelada." },
            { id: "guarana-lata", nome: "Guaraná Antarctica", preco: 9.90, descricao: "Lata de 350ml, bem gelada." },
            { id: "coca-1l", nome: "Coca-Cola 1L", preco: 19.90, descricao: "Garrafa de 1 litro, pra dividir." }
        ]
    }
];

// Formata um número como moeda brasileira. Ex.: 19.9 -> "R$ 19,90"
function formatarPreco(valor) {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Procura um item do cardápio pelo id. Retorna undefined se não existir.
function buscarItem(idItem) {
    for (const categoria of CATEGORIAS) {
        const itemEncontrado = categoria.itens.find(item => item.id === idItem);
        if (itemEncontrado) {
            return itemEncontrado;
        }
    }
    return undefined;
}

// Diz se o item é uma porção (porções acompanham maionese da casa grátis)
function ehPorcao(idItem) {
    const categoriaPorcoes = CATEGORIAS.find(categoria => categoria.temMolhoGratis);
    return categoriaPorcoes.itens.some(item => item.id === idItem);
}

// Procura um adicional pelo id. Retorna undefined se não existir.
function buscarAdicional(idAdicional) {
    return ADICIONAIS.find(adicional => adicional.id === idAdicional);
}

// Soma o preço dos adicionais escolhidos (lista de ids)
function somarAdicionais(idsAdicionais) {
    let soma = 0;
    for (const idAdicional of idsAdicionais || []) {
        const adicional = buscarAdicional(idAdicional);
        if (adicional) {
            soma += adicional.preco;
        }
    }
    return soma;
}

// Nomes dos adicionais escolhidos, separados por vírgula
function nomearAdicionais(idsAdicionais) {
    return (idsAdicionais || []).map(id => buscarAdicional(id)).filter(Boolean).map(a => a.nome).join(", ");
}

// Taxa de entrega para uma distância em km
function taxaPorDistancia(km) {
    return FAIXAS_ENTREGA.find(faixa => km <= faixa.ateKm).taxa;
}

// Soma os acréscimos dos burguers escolhidos num combo (ex.: F Prime no Combo Casal)
function somarAcrescimosBurguers(item, idsBurguers) {
    const acrescimos = (item && item.acrescimosBurguer) || {};
    return (idsBurguers || []).reduce((total, id) => total + (acrescimos[id] || 0), 0);
}

// Permite que o servidor (Cloudflare Worker) use exatamente os mesmos dados e preços.
// No navegador "module" não existe, então este trecho não faz nada.
if (typeof module !== "undefined") {
    module.exports = {
        CATEGORIAS, ADICIONAIS, PRECO_COMBO, FAIXAS_ENTREGA, LOJA,
        buscarItem, buscarAdicional, taxaPorDistancia
    };
}
