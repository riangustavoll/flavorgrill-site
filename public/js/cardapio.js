/*
  cardapio.js
  Monta o cardápio na tela a partir de dados.js e controla a janela
  onde o cliente personaliza o item (combo, observação e quantidade).
*/

const listaCardapio = document.getElementById("lista-cardapio");

const janelaItem = document.getElementById("janela-item");
const janelaTitulo = document.getElementById("janela-titulo");
const janelaDescricao = document.getElementById("janela-descricao");
const opcaoCombo = document.getElementById("opcao-combo");
const caixaCombo = document.getElementById("item-combo");
const entradaObservacao = document.getElementById("item-observacao");
const textoQuantidade = document.getElementById("item-quantidade");
const textoPrecoItem = document.getElementById("item-preco");
const grupoAdicionais = document.getElementById("grupo-adicionais");
const listaAdicionais = document.getElementById("lista-adicionais");
const grupoEscolhas = document.getElementById("grupo-escolhas");
const listaEscolhas = document.getElementById("lista-escolhas");

let itemSelecionado = null;
let quantidadeSelecionada = 1;

/* ---------- Criação dos elementos (sem innerHTML) ---------- */

function criarElemento(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) {
        elemento.className = classe;
    }
    if (texto) {
        elemento.textContent = texto;
    }
    return elemento;
}

// Título do item com o "F" destacado em laranja. Ex.: "F Smash"
function criarTituloItem(nome) {
    const titulo = criarElemento("h4");
    if (nome.startsWith("F ")) {
        titulo.append(criarElemento("span", "destaque", "F"), " " + nome.slice(2));
    } else {
        titulo.textContent = nome;
    }
    return titulo;
}

function criarCartaoItem(item) {
    const cartao = criarElemento("article", item.ehCombo ? "item item-pacote" : "item");

    if (item.etiqueta) {
        cartao.append(criarElemento("span", "etiqueta", item.etiqueta));
    }

    cartao.append(criarTituloItem(item.nome));
    // Combos: o que vem no pedido aparece em destaque antes da descrição
    if (item.destaque) {
        cartao.append(criarElemento("p", "pacote-inclui", item.destaque));
    }
    cartao.append(criarElemento("p", "", item.descricao));
    if (item.ehCombo) {
        cartao.append(criarElemento("span", "selo-entrega", "Entrega grátis"));
    }

    const rodape = criarElemento("div", "item-rodape");
    const botao = criarElemento("button", "botao-adicionar", "+ Adicionar");
    botao.type = "button";
    botao.dataset.idItem = item.id;
    botao.setAttribute("aria-label", "Adicionar " + item.nome);
    rodape.append(criarElemento("span", "preco", formatarPreco(item.preco)), botao);
    cartao.append(rodape);

    return cartao;
}

function criarCartaoMolhoGratis() {
    const cartao = criarElemento("article", "item item-promocao");
    const titulo = criarElemento("h4");
    titulo.append("Molho ", criarElemento("span", "destaque", "grátis"));
    cartao.append(
        criarElemento("span", "etiqueta", "Promoção"),
        titulo,
        criarElemento("p", "", "Na compra de qualquer porção, acompanha maionese da casa e barbecue sem custo extra.")
    );
    return cartao;
}

// Card do combo individual: ocupa o espaço livre na grade do Menu Flavor
function criarCartaoCombo() {
    const cartao = criarElemento("article", "item item-combo");
    cartao.id = "combo";
    cartao.append(
        criarElemento("span", "etiqueta", "Promoção"),
        criarElemento("div", "valor", "+" + formatarPreco(PRECO_COMBO).replace(",00", "")),
        criarElemento("h4", "", "Combo individual"),
        criarElemento("p", "combo-inclui", "Qualquer burguer + batata + refri lata"),
        criarElemento("span", "selo-entrega", "Entrega grátis"),
        criarElemento("p", "combo-instrucao", "É só marcar “Transformar em combo” quando adicionar o seu burguer.")
    );
    return cartao;
}

// Seção informativa: os adicionais são escolhidos dentro de cada burguer
function criarSecaoAdicionais() {
    const secao = criarElemento("section", "categoria");
    secao.id = "categoria-adicionais";
    secao.setAttribute("aria-label", "Adicionais");

    const grade = criarElemento("div", "itens");
    for (const adicional of ADICIONAIS) {
        const cartao = criarElemento("article", "item item-info");
        cartao.append(
            criarElemento("span", "etiqueta", "No seu burguer"),
            criarTituloItem(adicional.nome),
            criarElemento("p", "", adicional.descricao)
        );
        const rodape = criarElemento("div", "item-rodape");
        rodape.append(
            criarElemento("span", "preco", "+ " + formatarPreco(adicional.preco)),
            criarElemento("span", "aviso-item", "Escolha ao adicionar um burguer")
        );
        cartao.append(rodape);
        grade.append(cartao);
    }

    secao.append(criarElemento("h3", "", "Adicionais"), grade);
    return secao;
}

// Caixas de seleção dos adicionais dentro da janela do item
function criarOpcoesAdicionais() {
    for (const adicional of ADICIONAIS) {
        const rotulo = criarElemento("label", "opcao-adicional");
        const caixa = document.createElement("input");
        caixa.type = "checkbox";
        caixa.id = "adicional-" + adicional.id;
        caixa.value = adicional.id;
        rotulo.htmlFor = caixa.id;
        rotulo.append(caixa, criarElemento("span", "", adicional.nome), criarElemento("small", "", "+ " + formatarPreco(adicional.preco)));
        listaAdicionais.append(rotulo);
    }
}

// Cria uma lista de seleção para cada burguer que o cliente escolhe no combo
function montarEscolhasBurguers(item) {
    listaEscolhas.replaceChildren();
    const quantidade = item.escolherBurguers || 0;
    grupoEscolhas.hidden = quantidade === 0;
    grupoEscolhas.disabled = quantidade === 0;

    for (let numero = 1; numero <= quantidade; numero++) {
        const campo = criarElemento("div", "campo escolha-burguer");
        const rotulo = criarElemento("label", "", numero + "º burguer");
        const lista = document.createElement("select");
        lista.id = "escolha-burguer-" + numero;
        rotulo.htmlFor = lista.id;
        for (const idBurguer of item.burguersPermitidos) {
            const opcao = document.createElement("option");
            opcao.value = idBurguer;
            const acrescimo = (item.acrescimosBurguer || {})[idBurguer];
            opcao.textContent = buscarItem(idBurguer).nome + (acrescimo ? " (+" + formatarPreco(acrescimo) + ")" : "");
            lista.append(opcao);
        }
        campo.append(rotulo, lista);
        listaEscolhas.append(campo);
    }
}

function lerBurguersEscolhidos() {
    return Array.from(listaEscolhas.querySelectorAll("select")).map(lista => lista.value);
}

function lerAdicionaisMarcados() {
    return Array.from(listaAdicionais.querySelectorAll("input:checked")).map(caixa => caixa.value);
}

function renderizarCardapio() {
    for (const categoria of CATEGORIAS) {
        // A seção de adicionais fica entre os burguers e as porções
        if (categoria.temMolhoGratis) {
            listaCardapio.append(criarSecaoAdicionais());
        }

        const secao = criarElemento("section", "categoria");
        secao.id = categoria.id;
        secao.setAttribute("aria-label", categoria.nome);

        const grade = criarElemento("div", "itens");
        if (categoria.temMolhoGratis) {
            grade.append(criarCartaoMolhoGratis());
        }
        for (const item of categoria.itens) {
            grade.append(criarCartaoItem(item));
        }
        if (categoria.id === "categoria-flavor") {
            grade.append(criarCartaoCombo());
        }

        secao.append(criarElemento("h3", "", categoria.nome), grade);
        listaCardapio.append(secao);
    }
}

/* ---------- Janela de personalização ---------- */

function atualizarJanelaItem() {
    const precoUnitario = itemSelecionado.preco + (caixaCombo.checked ? PRECO_COMBO : 0) + somarAdicionais(lerAdicionaisMarcados())
        + somarAcrescimosBurguers(itemSelecionado, lerBurguersEscolhidos());
    textoQuantidade.textContent = quantidadeSelecionada;
    textoPrecoItem.textContent = formatarPreco(precoUnitario * quantidadeSelecionada);
}

function abrirJanelaItem(idItem) {
    itemSelecionado = buscarItem(idItem);
    quantidadeSelecionada = 1;

    janelaTitulo.textContent = itemSelecionado.nome;
    janelaDescricao.textContent = (itemSelecionado.destaque ? itemSelecionado.destaque + ". " : "") + itemSelecionado.descricao;
    // Combo e adicionais só aparecem para burguers
    const ehBurguer = Boolean(itemSelecionado.podeSerCombo);
    opcaoCombo.hidden = !ehBurguer;
    grupoAdicionais.hidden = !ehBurguer;
    grupoAdicionais.disabled = !ehBurguer;
    caixaCombo.checked = false;
    listaAdicionais.querySelectorAll("input").forEach(caixa => { caixa.checked = false; });
    montarEscolhasBurguers(itemSelecionado);
    entradaObservacao.value = "";

    atualizarJanelaItem();
    abrirCamada(janelaItem);
    document.getElementById("item-adicionar").focus();
}

// Delegação de eventos: um único ouvinte para todos os botões "Adicionar"
listaCardapio.addEventListener("click", function (evento) {
    const botao = evento.target.closest(".botao-adicionar");
    if (botao) {
        abrirJanelaItem(botao.dataset.idItem);
    }
});

caixaCombo.addEventListener("change", atualizarJanelaItem);
// Delegação de eventos: um único ouvinte para todas as caixas de adicionais
listaAdicionais.addEventListener("change", atualizarJanelaItem);
// Escolha dos burguers do combo: atualiza o preço quando há acréscimo (ex.: F Prime)
listaEscolhas.addEventListener("change", atualizarJanelaItem);

document.getElementById("item-mais").addEventListener("click", function () {
    quantidadeSelecionada = Math.min(quantidadeSelecionada + 1, 20);
    atualizarJanelaItem();
});

document.getElementById("item-menos").addEventListener("click", function () {
    quantidadeSelecionada = Math.max(quantidadeSelecionada - 1, 1);
    atualizarJanelaItem();
});

document.getElementById("item-adicionar").addEventListener("click", function () {
    adicionarAoCarrinho({
        id: itemSelecionado.id,
        quantidade: quantidadeSelecionada,
        combo: Boolean(itemSelecionado.podeSerCombo && caixaCombo.checked),
        adicionais: itemSelecionado.podeSerCombo ? lerAdicionaisMarcados() : [],
        burguers: lerBurguersEscolhidos(),
        observacao: entradaObservacao.value.trim()
    });
    fecharCamadas();
    mostrarAviso(quantidadeSelecionada + "x " + itemSelecionado.nome + " na sacola");
});

criarOpcoesAdicionais();
renderizarCardapio();
