/*
  painel.js — painel do dono e da equipe da The Flavor Grill
  - Atualiza os pedidos pagos a cada 15 segundos e toca um aviso para pedidos novos.
  - Todo texto vindo do servidor entra com textContent (nada de innerHTML com dados de clientes).
*/

const INTERVALO = 15000;
const ROTULOS_STATUS = {
    pago: "Novo",
    em_preparo: "Em preparo",
    saiu_para_entrega: "Saiu para entrega",
    entregue: "Entregue",
    cancelado: "Cancelado"
};
const PROXIMA_ACAO = { pago: "em_preparo", em_preparo: "saiu_para_entrega", saiu_para_entrega: "entregue" };
const GRUPOS = [
    { titulo: "Novos", status: ["pago"], vazio: "Nenhum pedido novo agora." },
    { titulo: "Em preparo", status: ["em_preparo"] },
    { titulo: "Saiu para entrega", status: ["saiu_para_entrega"] },
    { titulo: "Finalizados nas últimas 12 h", status: ["entregue", "cancelado"] }
];

let usuario = null;
let somLigado = false;
let contextoAudio = null;
const vistos = new Set(JSON.parse(sessionStorage.getItem("painel.vistos") || "[]"));
let primeiraCarga = vistos.size === 0;

/* ---------- Utilidades ---------- */

function criar(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto !== undefined) elemento.textContent = texto;
    return elemento;
}

function reais(centavos) {
    return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function centavos(texto) {
    const numero = Number(String(texto || "0").replace(/\./g, "").replace(",", "."));
    return Math.round(numero * 100);
}

function hora(ms) {
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

class SemAcesso extends Error {}
class SemConexao extends Error {}

async function api(caminho, opcoes = {}) {
    let resposta;
    try {
        resposta = await fetch("/api/painel" + caminho, {
            method: opcoes.metodo || "GET",
            headers: opcoes.corpo ? { "content-type": "application/json" } : {},
            body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
            credentials: "same-origin"
        });
    } catch (erro) {
        throw new SemConexao();
    }
    if (resposta.status === 401) throw new SemAcesso();
    if (resposta.status >= 500) throw new SemConexao();
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
        const erro = new Error(dados.mensagem || "Não deu certo. Tente de novo.");
        erro.status = resposta.status;
        throw erro;
    }
    return dados;
}

function mostrarSemConexao(sem) {
    document.getElementById("sem-conexao").hidden = !sem;
}

function mostrarSemAcesso() {
    document.getElementById("conteudo").hidden = true;
    document.getElementById("chave-loja").hidden = true;
    document.getElementById("sem-acesso").hidden = false;
    document.getElementById("usuario").textContent = "Sem acesso";
}

/* ---------- Som ---------- */

function tocarAviso() {
    if (!somLigado || !contextoAudio) return;
    const agora = contextoAudio.currentTime;
    [0, 0.25, 0.5].forEach((atraso, i) => {
        const oscilador = contextoAudio.createOscillator();
        const volume = contextoAudio.createGain();
        oscilador.frequency.value = i === 2 ? 1046 : 880;
        volume.gain.setValueAtTime(0.0001, agora + atraso);
        volume.gain.exponentialRampToValueAtTime(0.4, agora + atraso + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.2);
        oscilador.connect(volume).connect(contextoAudio.destination);
        oscilador.start(agora + atraso);
        oscilador.stop(agora + atraso + 0.22);
    });
}

document.getElementById("botao-som").addEventListener("click", function () {
    somLigado = !somLigado;
    if (somLigado && !contextoAudio) {
        const Contexto = window.AudioContext || window.webkitAudioContext;
        contextoAudio = Contexto ? new Contexto() : null;
    }
    this.setAttribute("aria-pressed", String(somLigado));
    this.textContent = somLigado ? "Som ligado" : "Ativar som";
    if (somLigado) tocarAviso();
});

/* ---------- Pedidos ---------- */

function enderecoEmTexto(endereco) {
    const partes = [endereco.rua + ", " + endereco.numero, endereco.bairro];
    if (endereco.referencia) partes.push(endereco.referencia);
    return partes.join(" · ");
}

function linhaRotulada(rotulo, valor) {
    const linha = criar("p", "cartao-linha");
    linha.append(criar("b", "", rotulo + ": "), valor);
    return linha;
}

function criarCartao(pedido, novo) {
    const cartao = criar("article", "cartao" + (novo ? " cartao-novo" : ""));
    cartao.dataset.codigo = pedido.codigo;

    const topo = criar("div", "cartao-topo");
    topo.append(
        criar("span", "cartao-codigo", pedido.codigo),
        criar("span", "etiqueta-status", ROTULOS_STATUS[pedido.status] || pedido.status),
        criar("span", "cartao-hora", "Pago às " + hora(pedido.pagoEm))
    );
    cartao.append(topo);

    if (pedido.alerta) {
        cartao.append(criar("p", "alerta", "Atenção: " + pedido.alerta));
    }

    const itens = criar("ul");
    for (const item of pedido.itens) {
        const linha = criar("li", "", item.descricao);
        if (item.observacao) linha.append(criar("span", "obs-item", "Obs.: " + item.observacao));
        itens.append(linha);
    }
    cartao.append(itens);

    if (pedido.observacoes) cartao.append(linhaRotulada("Obs. do pedido", pedido.observacoes));
    cartao.append(linhaRotulada("Cliente", pedido.cliente.nome));
    cartao.append(linhaRotulada("Entregar em", enderecoEmTexto(pedido.endereco)));
    let pagamento = reais(pedido.total) + (pedido.metodo === "pix" ? " no Pix" : pedido.metodo ? " no cartão" : "");
    if (pedido.entrega) pagamento += " (entrega " + reais(pedido.entrega) + ")";
    if (pedido.cupom) pagamento += " · cupom " + pedido.cupom;
    cartao.append(linhaRotulada("Pago", pagamento));

    const acoes = criar("div", "cartao-acoes");
    const proximo = PROXIMA_ACAO[pedido.status];
    if (proximo) {
        const botao = criar("button", "botao botao-primario", ROTULOS_STATUS[proximo]);
        botao.type = "button";
        botao.addEventListener("click", () => avancarStatus(pedido.codigo, proximo, botao));
        acoes.append(botao);
    }
    const whatsapp = criar("a", "botao botao-whatsapp", "Chamar no WhatsApp");
    whatsapp.href = "https://wa.me/55" + pedido.cliente.whatsapp;
    whatsapp.target = "_blank";
    whatsapp.rel = "noopener noreferrer";
    acoes.append(whatsapp);
    if (usuario.papel === "dono" && pedido.status !== "cancelado" && pedido.status !== "entregue") {
        const cancelar = criar("button", "botao botao-perigo", "Cancelar");
        cancelar.type = "button";
        cancelar.addEventListener("click", () => cancelarPedido(pedido.codigo, cancelar));
        acoes.append(cancelar);
    }
    cartao.append(acoes);
    return cartao;
}

function desenharPedidos(pedidos) {
    const lista = document.getElementById("lista-pedidos");
    let novos = 0;
    const fragmento = document.createDocumentFragment();
    for (const grupo of GRUPOS) {
        const doGrupo = pedidos.filter(p => grupo.status.includes(p.status));
        if (!doGrupo.length && !grupo.vazio) continue;
        const secao = criar("section", "grupo-pedidos");
        secao.append(criar("h2", "", grupo.titulo + (doGrupo.length ? " (" + doGrupo.length + ")" : "")));
        if (!doGrupo.length) secao.append(criar("p", "vazio", grupo.vazio));
        for (const pedido of doGrupo) {
            const novo = !vistos.has(pedido.codigo);
            if (novo) {
                vistos.add(pedido.codigo);
                if (!primeiraCarga) novos += 1;
            }
            secao.append(criarCartao(pedido, novo && !primeiraCarga));
        }
        fragmento.append(secao);
    }
    lista.replaceChildren(fragmento);
    sessionStorage.setItem("painel.vistos", JSON.stringify([...vistos]));
    primeiraCarga = false;
    if (novos > 0) {
        document.body.dataset.avisos = String(Number(document.body.dataset.avisos) + novos);
        tocarAviso();
        document.title = "(" + novos + ") Novo pedido! | The Flavor Grill";
    } else if (document.visibilityState === "visible") {
        document.title = "Painel | The Flavor Grill";
    }
}

async function atualizarPedidos() {
    try {
        const [{ pedidos }, { aberta }] = await Promise.all([api("/pedidos"), api("/loja")]);
        mostrarSemConexao(false);
        desenharPedidos(pedidos);
        mostrarLoja(aberta);
    } catch (erro) {
        if (erro instanceof SemAcesso) return mostrarSemAcesso();
        mostrarSemConexao(true);
    }
}

async function avancarStatus(codigo, status, botao) {
    botao.disabled = true;
    try {
        await api("/pedidos/" + codigo + "/status", { metodo: "POST", corpo: { status } });
    } catch (erro) {
        if (erro instanceof SemConexao) mostrarSemConexao(true);
    }
    await atualizarPedidos();
}

async function cancelarPedido(codigo, botao) {
    if (botao.dataset.confirmar !== "sim") {
        botao.dataset.confirmar = "sim";
        botao.textContent = "Confirmar cancelamento";
        setTimeout(() => {
            botao.dataset.confirmar = "";
            botao.textContent = "Cancelar";
        }, 5000);
        return;
    }
    try {
        const resposta = await api("/pedidos/" + codigo + "/cancelar", { metodo: "POST" });
        alertaRapido(resposta.mensagem);
    } catch (erro) {
        alertaRapido(erro.message);
    }
    await atualizarPedidos();
}

function alertaRapido(texto) {
    const faixa = criar("p", "faixa faixa-erro", texto);
    faixa.setAttribute("role", "status");
    document.getElementById("conteudo").prepend(faixa);
    setTimeout(() => faixa.remove(), 6000);
}

/* ---------- Loja aberta / fechada ---------- */

const chaveLoja = document.getElementById("chave-loja");

function mostrarLoja(aberta) {
    chaveLoja.setAttribute("aria-checked", String(aberta));
    chaveLoja.querySelector(".chave-texto").textContent = aberta ? "Loja aberta" : "Loja fechada";
    chaveLoja.title = aberta ? "Toque para fechar a loja" : "Toque para abrir a loja";
}

chaveLoja.addEventListener("click", async function () {
    const abrir = chaveLoja.getAttribute("aria-checked") !== "true";
    try {
        const { aberta } = await api("/loja", { metodo: "POST", corpo: { aberta: abrir } });
        mostrarLoja(aberta);
    } catch (erro) {
        mostrarSemConexao(true);
    }
});

/* ---------- Abas ---------- */

const abas = [...document.querySelectorAll('[role="tab"]')];

function abrirAba(aba) {
    for (const outra of abas) {
        const selecionada = outra === aba;
        outra.setAttribute("aria-selected", String(selecionada));
        document.getElementById(outra.getAttribute("aria-controls")).hidden = !selecionada;
    }
    const secao = aba.getAttribute("aria-controls");
    if (secao === "cupons") carregarCupons();
    if (secao === "resumo") carregarResumo();
    if (secao === "equipe") carregarEquipe();
}

abas.forEach(aba => aba.addEventListener("click", () => abrirAba(aba)));

/* ---------- Resumo ---------- */

async function carregarResumo() {
    const caixa = document.getElementById("cartoes-resumo");
    try {
        const { hoje, semana } = await api("/resumo");
        caixa.replaceChildren(...[["Hoje", hoje], ["Últimos 7 dias", semana]].map(([titulo, dados]) => {
            const bloco = criar("div", "bloco-resumo");
            const lista = criar("dl");
            lista.append(
                criar("dt", "", "Pedidos"), criar("dd", "", String(dados.pedidos)),
                criar("dt", "", "Vendas"), criar("dd", "", reais(dados.vendas)),
                criar("dt", "", "Ticket médio"), criar("dd", "", reais(dados.ticketMedio))
            );
            bloco.append(criar("h3", "", titulo), lista);
            return bloco;
        }));
    } catch (erro) {
        caixa.replaceChildren(criar("p", "vazio", "Não deu para carregar o resumo agora."));
    }
}

/* ---------- Cupons ---------- */

const formCupom = document.getElementById("form-cupom");
let cuponsAtuais = [];

function descreverCupom(cupom) {
    const partes = [cupom.tipo === "porcentagem" ? cupom.valor + "% de desconto" : reais(cupom.valor) + " de desconto"];
    if (cupom.minimo) partes.push("mínimo " + reais(cupom.minimo));
    if (cupom.primeiraCompra) partes.push("primeira compra");
    if (cupom.limiteUsos) partes.push(cupom.usos + " de " + cupom.limiteUsos + " usos");
    else partes.push(cupom.usos + (cupom.usos === 1 ? " uso" : " usos"));
    if (cupom.validoAte) partes.push("até " + new Date(cupom.validoAte).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }));
    return partes.join(" · ");
}

async function salvarCupom(dados) {
    await api("/cupons", { metodo: "POST", corpo: dados });
    await carregarCupons();
}

async function carregarCupons() {
    const lista = document.getElementById("lista-cupons");
    try {
        ({ cupons: cuponsAtuais } = await api("/cupons"));
    } catch (erro) {
        lista.replaceChildren(criar("p", "vazio", "Não deu para carregar os cupons agora."));
        return;
    }
    lista.replaceChildren(...cuponsAtuais.map(cupom => {
        const linha = criar("div", "linha-lista");
        const texto = criar("div");
        texto.append(criar("strong", "", cupom.codigo + (cupom.ativo ? "" : " (pausado)")), criar("br"), descreverCupom(cupom));
        const acoes = criar("div", "acoes");
        const pausar = criar("button", "botao botao-secundario", cupom.ativo ? "Pausar" : "Ativar");
        pausar.type = "button";
        pausar.setAttribute("aria-label", (cupom.ativo ? "Pausar " : "Ativar ") + cupom.codigo);
        pausar.addEventListener("click", () => salvarCupom({ ...cupom, ativo: !cupom.ativo }));
        const editar = criar("button", "botao botao-secundario", "Editar");
        editar.type = "button";
        editar.setAttribute("aria-label", "Editar " + cupom.codigo);
        editar.addEventListener("click", () => preencherFormCupom(cupom));
        acoes.append(pausar, editar);
        linha.append(texto, acoes);
        return linha;
    }));
}

function preencherFormCupom(cupom) {
    document.getElementById("titulo-form-cupom").textContent = "Editar " + cupom.codigo;
    formCupom.codigo.value = cupom.codigo;
    formCupom.tipo.value = cupom.tipo;
    formCupom.valor.value = cupom.tipo === "porcentagem" ? cupom.valor : (cupom.valor / 100).toFixed(2).replace(".", ",");
    formCupom.minimo.value = cupom.minimo ? (cupom.minimo / 100).toFixed(2).replace(".", ",") : "";
    formCupom.limite.value = cupom.limiteUsos || "";
    formCupom.validade.value = cupom.validoAte ? new Date(cupom.validoAte - 3 * 3600000).toISOString().slice(0, 10) : "";
    formCupom.primeiraCompra.checked = cupom.primeiraCompra;
    formCupom.ativo.checked = cupom.ativo;
    formCupom.codigo.focus();
}

formCupom.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const mensagem = document.getElementById("mensagem-cupom");
    const tipo = formCupom.tipo.value;
    const validade = formCupom.validade.value;
    const dados = {
        codigo: formCupom.codigo.value,
        tipo,
        valor: tipo === "porcentagem" ? Math.round(Number(formCupom.valor.value.replace(",", "."))) : centavos(formCupom.valor.value),
        minimo: centavos(formCupom.minimo.value),
        limiteUsos: formCupom.limite.value ? Number(formCupom.limite.value) : null,
        // Vale até o fim do dia escolhido, no horário de Brasília
        validoAte: validade ? Date.parse(validade + "T23:59:59-03:00") : null,
        primeiraCompra: formCupom.primeiraCompra.checked,
        ativo: formCupom.ativo.checked
    };
    try {
        await salvarCupom(dados);
        mensagem.dataset.estado = "ok";
        mensagem.textContent = "Cupom " + dados.codigo.toUpperCase() + " salvo.";
        formCupom.reset();
        document.getElementById("titulo-form-cupom").textContent = "Novo cupom";
    } catch (erro) {
        mensagem.dataset.estado = "erro";
        mensagem.textContent = erro.message;
    }
});

/* ---------- Equipe ---------- */

const formEquipe = document.getElementById("form-equipe");

async function carregarEquipe() {
    const lista = document.getElementById("lista-equipe");
    let equipe;
    try {
        ({ equipe } = await api("/equipe"));
    } catch (erro) {
        lista.replaceChildren(criar("li", "vazio", "Não deu para carregar a equipe agora."));
        return;
    }
    lista.replaceChildren(...equipe.map(membro => {
        const linha = criar("li", "linha-lista");
        const texto = criar("div");
        texto.append(criar("strong", "", membro.email), criar("br"), membro.papel === "dono" ? "Dono: pode tudo" : "Equipe: pedidos e loja");
        linha.append(texto);
        if (!membro.fixo) {
            const remover = criar("button", "botao botao-perigo", "Remover");
            remover.type = "button";
            remover.setAttribute("aria-label", "Remover " + membro.email);
            remover.addEventListener("click", async () => {
                await api("/equipe", { metodo: "DELETE", corpo: { email: membro.email } }).catch(() => {});
                carregarEquipe();
            });
            linha.append(remover);
        }
        return linha;
    }));
}

formEquipe.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const mensagem = document.getElementById("mensagem-equipe");
    try {
        await api("/equipe", { metodo: "POST", corpo: { email: formEquipe.email.value, papel: formEquipe.papel.value } });
        mensagem.dataset.estado = "ok";
        mensagem.textContent = "Pronto! Essa pessoa já pode entrar com o e-mail.";
        formEquipe.reset();
        carregarEquipe();
    } catch (erro) {
        mensagem.dataset.estado = "erro";
        mensagem.textContent = erro.message;
    }
});

/* ---------- Início ---------- */

async function iniciar() {
    try {
        usuario = await api("/eu");
    } catch (erro) {
        if (erro instanceof SemAcesso) return mostrarSemAcesso();
        mostrarSemConexao(true);
        setTimeout(iniciar, INTERVALO);
        return;
    }
    document.getElementById("usuario").textContent = usuario.email;
    document.getElementById("conteudo").hidden = false;
    chaveLoja.hidden = false;
    for (const aba of document.querySelectorAll("[data-so-dono]")) {
        if (usuario.papel === "dono") aba.hidden = false;
        else aba.remove();
    }
    await atualizarPedidos();
    setInterval(atualizarPedidos, INTERVALO);
}

iniciar();
