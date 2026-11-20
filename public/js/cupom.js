/*
  cupom.js
  Cupom de desconto na finalização do pedido.
  Quem decide se o cupom vale é o servidor (/api/cupons/verificar): aqui o site só mostra
  o desconto. Na hora de pagar, o servidor confere o cupom de novo e calcula o total.
*/

const entradaCupom = document.getElementById("cliente-cupom");
const statusCupom = document.getElementById("status-cupom");
const botaoRemoverCupom = document.getElementById("remover-cupom");

// Cupom em uso: { codigo, desconto (em reais), subtotal (em centavos, de quando foi conferido) } ou null
let cupomAplicado = null;
let conferindoCupom = false;

function normalizarCodigo(texto) {
    return texto.trim().toUpperCase().replace(/\s+/g, "");
}

function mostrarStatusCupom(estado, texto) {
    statusCupom.dataset.estado = estado;
    statusCupom.textContent = texto;
}

function emCentavos(valor) {
    return Math.round(valor * 100);
}

// Desconto em reais (para somar na tela)
function calcularDesconto() {
    return cupomAplicado ? cupomAplicado.desconto : 0;
}

async function conferirCupom(codigo) {
    const resposta = await fetch("/api/cupons/verificar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            codigo,
            whatsapp: formularioPedido.elements.whatsapp.value,
            subtotal: emCentavos(calcularSubtotal())
        })
    });
    if (!resposta.ok) {
        throw new Error("servidor");
    }
    return resposta.json();
}

async function aplicarCupom() {
    const codigo = normalizarCodigo(entradaCupom.value);
    if (!codigo) {
        mostrarStatusCupom("erro", "Digite o código do cupom.");
        entradaCupom.focus();
        return;
    }
    mostrarStatusCupom("", "Conferindo o cupom…");
    try {
        const resultado = await conferirCupom(codigo);
        if (!resultado.ok) {
            mostrarStatusCupom("erro", resultado.mensagem);
            return;
        }
        cupomAplicado = { codigo: resultado.codigo, desconto: resultado.desconto / 100, subtotal: emCentavos(calcularSubtotal()) };
        entradaCupom.value = resultado.codigo;
        atualizarFormulario();
    } catch (erro) {
        mostrarStatusCupom("erro", "Não conseguimos conferir o cupom agora. Tente de novo em instantes.");
    }
}

function removerCupom(mensagem) {
    cupomAplicado = null;
    entradaCupom.value = "";
    mostrarStatusCupom(mensagem ? "erro" : "", mensagem || "");
    atualizarFormulario();
}

// Quando a sacola muda, o desconto é conferido de novo (porcentagem e valor mínimo mudam junto)
async function reconferirCupom() {
    if (!cupomAplicado || conferindoCupom) {
        return;
    }
    conferindoCupom = true;
    try {
        const resultado = await conferirCupom(cupomAplicado.codigo);
        if (!cupomAplicado) return;
        if (resultado.ok) {
            cupomAplicado = { ...cupomAplicado, desconto: resultado.desconto / 100, subtotal: emCentavos(calcularSubtotal()) };
            atualizarFormulario();
        } else {
            removerCupom(resultado.mensagem + " Ele foi removido.");
        }
    } catch (erro) {
        // Sem conexão: mantém o cupom; o servidor confere de novo ao pagar
    } finally {
        conferindoCupom = false;
    }
}

// Chamada a cada mudança no pedido: atualiza os botões e o texto do cupom
function atualizarCupom() {
    const temCupom = Boolean(cupomAplicado);
    entradaCupom.readOnly = temCupom;
    document.getElementById("aplicar-cupom").hidden = temCupom;
    botaoRemoverCupom.hidden = !temCupom;
    if (!temCupom) {
        return;
    }
    if (cupomAplicado.subtotal !== emCentavos(calcularSubtotal())) {
        reconferirCupom();
    }
    mostrarStatusCupom("ok", cupomAplicado.codigo + " aplicado: −" + formatarPreco(calcularDesconto()) + ".");
}

document.getElementById("aplicar-cupom").addEventListener("click", aplicarCupom);
botaoRemoverCupom.addEventListener("click", function () {
    removerCupom();
    entradaCupom.focus();
});
// Enter no campo do cupom aplica o cupom (em vez de enviar o pedido)
entradaCupom.addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") {
        evento.preventDefault();
        if (!cupomAplicado) {
            aplicarCupom();
        }
    }
});
