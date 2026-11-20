/*
  checkout.js
  Finalização do pedido com o servidor da loja:
  - confere se a loja está aberta (e oferece o WhatsApp se o servidor estiver fora do ar);
  - preenche rua e bairro pelo CEP (ViaCEP) e pede ao servidor a taxa de entrega;
  - envia o pedido ao servidor, que calcula o total e devolve o link de pagamento da InfinitePay;
  - na volta do pagamento (/?pedido=FG...), confirma se o pedido foi pago.
  O navegador nunca manda preços: o servidor recalcula tudo.
*/

const formularioPedido = document.getElementById("formulario-pedido");
const entradaCep = document.getElementById("cliente-cep");
const entradaWhatsapp = document.getElementById("cliente-whatsapp");
const statusCep = document.getElementById("status-cep");
const avisoTaxa = document.getElementById("aviso-taxa");
const erroPedido = document.getElementById("erro-pedido");
const linkEntregaWhatsapp = document.getElementById("entrega-whatsapp");

// Campos que são lembrados para o próximo pedido
const CAMPOS_LEMBRADOS = ["nome", "whatsapp", "cep", "rua", "numero", "bairro", "referencia"];

function lerCampo(nome) {
    return formularioPedido.elements[nome].value.trim();
}

function criarLinkWhatsApp(mensagem) {
    return "https://wa.me/" + NUMERO_WHATSAPP + "?text=" + encodeURIComponent(mensagem);
}

async function chamarApi(caminho, opcoes = {}) {
    const resposta = await fetch(caminho, {
        method: opcoes.metodo || "GET",
        headers: opcoes.corpo ? { "content-type": "application/json" } : {},
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
    });
    const dados = await resposta.json().catch(() => ({}));
    return { status: resposta.status, ok: resposta.ok, dados };
}

/* ---------- Loja aberta, fechada ou servidor fora do ar ---------- */

// "verificando", "aberta", "fechada" ou "indisponivel"
let estadoLoja = "verificando";

function lojaPermitePedido() {
    return estadoLoja === "aberta";
}

function mostrarEstadoLoja(estado) {
    estadoLoja = estado;
    const faixa = document.getElementById("faixa-loja");
    const texto = document.getElementById("faixa-loja-texto");
    const whatsapp = document.getElementById("faixa-loja-whatsapp");
    faixa.hidden = estado === "aberta" || estado === "verificando";
    faixa.dataset.estado = estado;
    if (estado === "fechada") {
        texto.textContent = "Estamos fechados agora. Volte mais tarde!";
        whatsapp.hidden = true;
    } else if (estado === "indisponivel") {
        texto.textContent = "Pedidos pelo site indisponíveis no momento. Você pode pedir pelo WhatsApp.";
        whatsapp.href = criarLinkWhatsApp("Olá! Quero fazer um pedido. 🍔");
        whatsapp.hidden = false;
    }
    atualizarSacola();
}

async function verificarLoja() {
    try {
        const { ok, dados } = await chamarApi("/api/loja");
        mostrarEstadoLoja(!ok ? "indisponivel" : dados.aberta ? "aberta" : "fechada");
    } catch (erro) {
        mostrarEstadoLoja("indisponivel");
    }
}

/* ---------- Máscaras dos campos ---------- */

function apenasNumeros(texto) {
    return texto.replace(/\D/g, "");
}

// (83) 99999-9999 ou (83) 9999-9999
function formatarTelefone(texto) {
    const n = apenasNumeros(texto).slice(0, 11);
    if (n.length <= 2) return n.length ? "(" + n : "";
    const meio = n.length === 11 ? 7 : 6;
    if (n.length <= meio) return "(" + n.slice(0, 2) + ") " + n.slice(2);
    return "(" + n.slice(0, 2) + ") " + n.slice(2, meio) + "-" + n.slice(meio);
}

function formatarCep(texto) {
    const n = apenasNumeros(texto).slice(0, 8);
    return n.length > 5 ? n.slice(0, 5) + "-" + n.slice(5) : n;
}

/* ---------- Endereço pelo CEP e taxa de entrega (calculada pelo servidor) ---------- */

// estado: "vazio", "buscando", "ok", "indisponivel", "invalido" ou "falhou"
const entrega = { estado: "vazio", cep: "", taxa: null };
let buscaEmAndamento = null;

function formatarKm(km) {
    return "≈ " + km.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " km";
}

async function buscarEndereco(cep) {
    const resposta = await fetch("https://viacep.com.br/ws/" + cep + "/json/");
    if (!resposta.ok) {
        throw new Error("ViaCEP indisponível");
    }
    const dados = await resposta.json();
    if (dados.erro) {
        return null;
    }
    return { rua: dados.logradouro, bairro: dados.bairro, cidade: dados.localidade };
}

function mostrarStatusCep(estado, texto) {
    statusCep.dataset.estado = estado;
    statusCep.textContent = texto;
    linkEntregaWhatsapp.hidden = estado !== "indisponivel";
    if (estado === "indisponivel") {
        linkEntregaWhatsapp.href = criarLinkWhatsApp("Olá! Quero fazer um pedido para o CEP " + formatarCep(entrega.cep) + ". 🍔");
    }
}

// Rua e bairro preenchidos automaticamente pelo último CEP consultado
const preenchidoPeloCep = { rua: "", bairro: "" };

// Preenche rua e bairro com o que veio do CEP (sem apagar o que o cliente já digitou)
function preencherCampo(nome, valor, substituir) {
    const campo = formularioPedido.elements[nome];
    if (valor && (substituir || !campo.value.trim())) {
        campo.value = valor;
        preenchidoPeloCep[nome] = valor;
    }
}

// CEP novo sem resultado: limpa rua e bairro que vieram do CEP anterior
function limparPreenchidoPeloCep() {
    for (const nome of ["rua", "bairro"]) {
        const campo = formularioPedido.elements[nome];
        if (preenchidoPeloCep[nome] && campo.value === preenchidoPeloCep[nome]) {
            campo.value = "";
        }
        preenchidoPeloCep[nome] = "";
    }
    lembrarDadosDoCliente();
}

async function calcularEntregaDoCep(cep, cepMudou) {
    entrega.estado = "buscando";
    mostrarStatusCep("buscando", "Buscando seu endereço…");
    atualizarFormulario();

    let endereco = null;
    try {
        endereco = await buscarEndereco(cep);
        if (!endereco) {
            if (apenasNumeros(entradaCep.value) === cep) {
                entrega.estado = "invalido";
                limparPreenchidoPeloCep();
                entradaCep.setCustomValidity("CEP não encontrado. Confira os números.");
                mostrarStatusCep("falhou", "CEP não encontrado. Confira os números.");
            }
            return;
        }
    } catch (erro) {
        endereco = null;
    }
    if (apenasNumeros(entradaCep.value) !== cep) {
        return;
    }
    if (endereco) {
        preencherCampo("rua", endereco.rua, cepMudou);
        preencherCampo("bairro", endereco.bairro, cepMudou);
        lembrarDadosDoCliente();
    }

    let resposta;
    try {
        resposta = await chamarApi("/api/entrega", { metodo: "POST", corpo: { cep, rua: lerCampo("rua"), bairro: lerCampo("bairro") } });
    } catch (erro) {
        resposta = null;
    }
    // O cliente pode ter trocado o CEP enquanto a busca acontecia
    if (apenasNumeros(entradaCep.value) !== cep) {
        return;
    }
    if (resposta && resposta.ok) {
        entrega.estado = "ok";
        entrega.taxa = resposta.dados.taxa / 100;
        const lugar = endereco ? [endereco.bairro, endereco.cidade].filter(Boolean).join(", ") + " · " : "";
        mostrarStatusCep("ok", lugar + formatarKm(resposta.dados.distanciaKm) + " da loja");
    } else if (resposta && resposta.status === 422) {
        entrega.estado = "indisponivel";
        entrega.taxa = null;
        mostrarStatusCep("indisponivel", "Não entregamos nesse endereço pelo site. Fale com a gente pelo WhatsApp.");
    } else {
        entrega.estado = "falhou";
        entrega.taxa = null;
        mostrarStatusCep("falhou", "Não conseguimos calcular a entrega agora. Tente de novo em instantes.");
    }
}

// Chamada quando o CEP muda: só busca com os 8 números completos
function aoMudarCep(cepMudou) {
    const cep = apenasNumeros(entradaCep.value);
    if (cep === entrega.cep && entrega.estado !== "vazio" && entrega.estado !== "falhou") {
        return;
    }
    entrega.cep = cep;
    entrega.taxa = null;
    entradaCep.setCustomValidity("");
    if (cep.length !== 8) {
        entrega.estado = "vazio";
        mostrarStatusCep("", "");
        atualizarFormulario();
        return;
    }
    const busca = calcularEntregaDoCep(cep, cepMudou).finally(function () {
        if (buscaEmAndamento === busca) {
            buscaEmAndamento = null;
        }
        atualizarFormulario();
    });
    buscaEmAndamento = busca;
}

// Retorna { valor, texto }: valor null quando a taxa ainda não é conhecida
function calcularEntrega() {
    if (temCombo()) {
        return { valor: 0, texto: "Grátis (combo)" };
    }
    if (entrega.estado === "ok") {
        return { valor: entrega.taxa, texto: formatarPreco(entrega.taxa) };
    }
    if (entrega.estado === "buscando") {
        return { valor: null, texto: "calculando…" };
    }
    return { valor: null, texto: "a calcular" };
}

function calcularTotal() {
    const entregaAtual = calcularEntrega();
    return calcularSubtotal() - calcularDesconto() + (entregaAtual.valor || 0);
}

/* ---------- Ajustes conforme as escolhas do cliente ---------- */

function atualizarFormulario() {
    atualizarCupom();
    const desconto = calcularDesconto();
    document.getElementById("linha-desconto").hidden = desconto === 0;
    document.getElementById("valor-desconto").textContent = "−" + formatarPreco(desconto);

    const entregaAtual = calcularEntrega();
    document.getElementById("valor-entrega").textContent = entregaAtual.texto;
    document.getElementById("total").textContent = formatarPreco(calcularTotal()) + (entregaAtual.valor === null ? " + entrega" : "");

    if (temCombo()) {
        avisoTaxa.textContent = "Entrega grátis: seu pedido tem combo!";
    } else if (entrega.estado !== "ok") {
        avisoTaxa.textContent = "A taxa de entrega é calculada pelo seu CEP.";
    } else {
        avisoTaxa.textContent = "";
    }

    // Só deixa pagar com a loja aberta e, sem combo, com a taxa de entrega conhecida
    botaoFinalizar.disabled = !lojaPermitePedido() || (!temCombo() && entrega.estado === "indisponivel");

    listarObservacoesDosItens();
}

// Mostra, acima do campo de observações, o que o cliente já anotou em cada item
function listarObservacoesDosItens() {
    const lista = document.getElementById("obs-itens");
    const entradaObservacoes = document.getElementById("cliente-observacoes");
    lista.replaceChildren();
    for (const linha of carrinho) {
        if (linha.observacao) {
            const item = criarElemento("li", "");
            item.append(criarElemento("b", "", buscarItem(linha.id).nome + ": "), linha.observacao);
            lista.append(item);
        }
    }
    lista.hidden = lista.children.length === 0;
    entradaObservacoes.placeholder = lista.hidden ? "Algo que a gente precise saber?" : "Mais alguma coisa que a gente precise saber?";
}

function lembrarDadosDoCliente() {
    const dados = {};
    for (const campo of CAMPOS_LEMBRADOS) {
        dados[campo] = lerCampo(campo);
    }
    salvarNoArmazenamento(CHAVE_CLIENTE, dados);
}

function preencherDadosSalvos() {
    const dadosSalvos = lerDoArmazenamento(CHAVE_CLIENTE, {});
    for (const campo of CAMPOS_LEMBRADOS) {
        if (dadosSalvos[campo]) {
            formularioPedido.elements[campo].value = dadosSalvos[campo];
        }
    }
}

/* ---------- Envio do pedido e ida para o pagamento ---------- */

function mostrarErroPedido(texto) {
    erroPedido.textContent = texto;
    erroPedido.hidden = !texto;
}

// A vaquinha surge e o navegador segue para a página de pagamento da InfinitePay.
// Quem pediu ao sistema menos movimento na tela espera menos.
function irParaPagamento(url) {
    document.getElementById("confirmacao").hidden = false;
    const espera = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 300 : 1300;
    setTimeout(function () {
        window.location.assign(url);
    }, espera);
}

function montarPedido() {
    return {
        itens: carrinho.map(linha => ({
            id: linha.id,
            quantidade: linha.quantidade,
            combo: linha.combo,
            adicionais: linha.adicionais,
            burguers: linha.burguers,
            observacao: linha.observacao
        })),
        cliente: { nome: lerCampo("nome"), whatsapp: lerCampo("whatsapp") },
        endereco: { cep: lerCampo("cep"), rua: lerCampo("rua"), numero: lerCampo("numero"), bairro: lerCampo("bairro"), referencia: lerCampo("referencia") },
        cupom: cupomAplicado ? cupomAplicado.codigo : "",
        observacoes: lerCampo("observacoes")
    };
}

// O evento submit só acontece se todos os campos obrigatórios estiverem válidos
formularioPedido.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    if (contarItens() === 0 || !lojaPermitePedido()) {
        return;
    }
    // Se a taxa ainda está sendo calculada, espera terminar e confere o CEP de novo
    if (buscaEmAndamento) {
        await buscaEmAndamento;
        if (!formularioPedido.reportValidity()) {
            return;
        }
    }
    mostrarErroPedido("");
    botaoFinalizar.disabled = true;
    botaoFinalizar.textContent = "Enviando…";
    let resposta;
    try {
        resposta = await chamarApi("/api/pedidos", { metodo: "POST", corpo: montarPedido() });
    } catch (erro) {
        resposta = null;
    }
    botaoFinalizar.textContent = "Ir para o pagamento";
    if (resposta && resposta.status === 201) {
        irParaPagamento(resposta.dados.url);
        return;
    }
    botaoFinalizar.disabled = false;
    if (!resposta) {
        mostrarErroPedido("Sem conexão com a loja. Confira sua internet e tente de novo.");
    } else if (resposta.dados.erro === "loja_fechada") {
        mostrarEstadoLoja("fechada");
        mostrarErroPedido(resposta.dados.mensagem);
    } else {
        mostrarErroPedido(resposta.dados.mensagem || "Não deu para enviar o pedido. Tente de novo em instantes.");
    }
    atualizarFormulario();
});

/* ---------- Volta do pagamento: /?pedido=FGXXXXX ---------- */

async function acompanharPagamento(parametros) {
    const codigo = parametros.get("pedido");
    const titulo = document.getElementById("pronto-titulo");
    const texto = document.getElementById("pronto-texto");
    const whatsapp = document.getElementById("pronto-whatsapp");
    // Tira os dados do pagamento da barra de endereço (o código fica guardado aqui)
    history.replaceState(null, "", window.location.pathname);
    abrirCamada(sacola);
    mostrarEtapaPronto();
    whatsapp.href = criarLinkWhatsApp("Olá! Sobre o meu pedido " + codigo + ". 🍔");

    const busca = new URLSearchParams();
    if (parametros.get("transaction_nsu") && parametros.get("slug")) {
        busca.set("transaction_nsu", parametros.get("transaction_nsu"));
        busca.set("slug", parametros.get("slug"));
    }
    for (let tentativa = 0; tentativa < 20; tentativa++) {
        try {
            const { ok, dados } = await chamarApi("/api/pedidos/" + encodeURIComponent(codigo) + (busca.toString() ? "?" + busca : ""));
            if (ok && dados.status !== "aguardando_pagamento" && dados.status !== "expirado") {
                titulo.textContent = "Pedido " + codigo + " pago!";
                texto.textContent = "Recebemos seu pagamento e seu pedido já foi para a cozinha. Qualquer dúvida, fale com a gente.";
                whatsapp.hidden = false;
                esvaziarCarrinho();
                mostrarEtapaPronto();
                return;
            }
        } catch (erro) {
            // tenta de novo
        }
        await new Promise(resolver => setTimeout(resolver, 3000));
    }
    titulo.textContent = "Pedido " + codigo;
    texto.textContent = "Ainda não recebemos a confirmação. Se você já pagou, ela chega em instantes. Se precisar, fale com a gente.";
    whatsapp.hidden = false;
}

/* ---------- Eventos ---------- */

formularioPedido.addEventListener("change", function () {
    atualizarFormulario();
    lembrarDadosDoCliente();
});
formularioPedido.addEventListener("input", lembrarDadosDoCliente);

entradaWhatsapp.addEventListener("input", function () {
    entradaWhatsapp.value = formatarTelefone(entradaWhatsapp.value);
});
entradaCep.addEventListener("input", function () {
    entradaCep.value = formatarCep(entradaCep.value);
    aoMudarCep(true);
});

document.getElementById("novo-pedido").addEventListener("click", function () {
    esvaziarCarrinho();
    fecharCamadas();
    mostrarAviso("Pronto para um novo pedido!");
});

document.getElementById("link-whatsapp").href = criarLinkWhatsApp("Olá! Vim pelo site da The Flavor Grill. 🍔");

// Distâncias guardadas pela versão antiga do site (agora o servidor calcula)
removerDoArmazenamento("flavorgrill.distancias");

preencherDadosSalvos();
aoMudarCep(false);
atualizarFormulario();
verificarLoja();

const parametrosDaUrl = new URLSearchParams(window.location.search);
if (parametrosDaUrl.get("pedido")) {
    acompanharPagamento(parametrosDaUrl);
}
