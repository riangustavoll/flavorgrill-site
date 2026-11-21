"""Site falando com o servidor: loja aberta/fechada, entrega, pagamento online e volta do pagamento."""
import json, os, re
import pytest
from playwright.sync_api import sync_playwright, expect
from servidor import Servidor, preparar_banco, sql, URL
from infinitepay_falsa import iniciar, Estado
from test_painel import checar_contraste_e_toque

VIACEP = {"cep": "58055-000", "logradouro": "Rua das Flores", "bairro": "Mangabeira", "localidade": "João Pessoa", "uf": "PB", "estado": "Paraíba"}


@pytest.fixture(scope="module")
def ambiente():
    preparar_banco()
    sql("INSERT INTO ceps (cep, distancia_km, atualizado_em) VALUES ('58055000', 4.2, 9999999999999)")
    falsa = iniciar()
    with Servidor(), sync_playwright() as p:
        navegador = p.chromium.launch()
        yield navegador
        navegador.close()
    falsa.shutdown()


def nova_pagina(navegador):
    contexto = navegador.new_context(viewport={"width": 390, "height": 844})
    pagina = contexto.new_page()
    pagina.route(re.compile(r"viacep\.com\.br"), lambda rota: rota.fulfill(json=VIACEP))
    pedidos_mapa = []
    pagina.on("request", lambda r: pedidos_mapa.append(r.url) if "nominatim" in r.url else None)
    pagina.pedidos_mapa = pedidos_mapa
    erros_js = []
    pagina.on("pageerror", lambda erro: erros_js.append(str(erro)))
    pagina.erros_js = erros_js
    return pagina


def loja(aberta):
    sql(f"UPDATE config SET valor = '{1 if aberta else 0}' WHERE chave = 'loja_aberta'")


def adicionar(pagina, id_item):
    pagina.locator(f"[data-id-item={id_item}]").click()
    pagina.locator("#item-adicionar").click()
    pagina.wait_for_timeout(300)


def abrir_finalizar(pagina):
    pagina.locator("#botao-barra-sacola").click()
    pagina.locator("#continuar").click()


def preencher(pagina, cep="58055-000"):
    pagina.fill("#cliente-nome", "Ana Souza")
    pagina.fill("#cliente-whatsapp", "(83) 98877-6655")
    pagina.fill("#cliente-email", "ana.souza@email.com")
    pagina.fill("#cliente-cep", cep)
    pagina.fill("#cliente-numero", "10")


def test_loja_fechada_bloqueia_pedido(ambiente):
    loja(False)
    pagina = nova_pagina(ambiente)
    pagina.goto(URL + "/")
    expect(pagina.get_by_text("Estamos fechados agora. Volte mais tarde!")).to_be_visible()
    adicionar(pagina, "classico")
    pagina.locator("#botao-barra-sacola").click()
    expect(pagina.locator("#continuar")).to_be_disabled()
    pagina.context.close()


def test_servidor_fora_oferece_whatsapp(ambiente):
    pagina = nova_pagina(ambiente)
    pagina.route("**/api/loja", lambda rota: rota.abort())
    pagina.goto(URL + "/")
    expect(pagina.get_by_text("Pedidos pelo site indisponíveis no momento")).to_be_visible()
    expect(pagina.locator("#faixa-loja").get_by_role("link", name="Pedir pelo WhatsApp")).to_have_attribute("href", re.compile(r"^https://wa\.me/5583998903631"))
    pagina.context.close()


def test_pedido_completo_pago(ambiente):
    loja(True)
    pagina = nova_pagina(ambiente)
    pagina.goto(URL + "/")
    adicionar(pagina, "combo-casal")
    abrir_finalizar(pagina)
    preencher(pagina)
    expect(pagina.locator("#cliente-rua")).to_have_value("Rua das Flores")
    expect(pagina.get_by_text("Pagamento online")).to_be_visible()
    checar_contraste_e_toque(pagina, "#sacola")
    pagina.get_by_role("button", name="Ir para o pagamento").click()
    expect(pagina.get_by_text("Pedido recebido! Indo para o pagamento…")).to_be_visible()
    pagina.wait_for_url(re.compile(r"localhost:8799/pagar/FG"), timeout=10000)
    codigo = pagina.url.rsplit("/", 1)[1]
    assert Estado.links[codigo]["items"][0]["price"] == 8990
    assert Estado.links[codigo]["customer"]["email"] == "ana.souza@email.com"
    pagina.get_by_role("button", name="Pagar").click()
    pagina.wait_for_url(re.compile(r"localhost:8787/"))
    expect(pagina.get_by_text(f"Pedido {codigo} pago!")).to_be_visible(timeout=10000)
    assert sql(f"SELECT status FROM pedidos WHERE codigo = '{codigo}'")[0]["status"] == "pago"
    assert pagina.evaluate("JSON.parse(localStorage.getItem('flavorgrill.carrinho') || '[]').length") == 0
    checar_contraste_e_toque(pagina, "#sacola")
    assert pagina.pedidos_mapa == []
    assert pagina.erros_js == []
    pagina.context.close()


def test_email_aparece_como_teclado_de_email_e_e_obrigatorio(ambiente):
    loja(True)
    pagina = nova_pagina(ambiente)
    pagina.goto(URL + "/")
    adicionar(pagina, "combo-casal")
    abrir_finalizar(pagina)
    campo = pagina.get_by_label("E-mail")
    expect(campo).to_have_attribute("type", "email")
    expect(campo).to_have_attribute("autocomplete", "email")
    expect(campo).to_have_attribute("required", "")
    pagina.context.close()


def test_sem_distancia_e_sem_combo_bloqueia_com_whatsapp(ambiente):
    loja(True)
    pagina = nova_pagina(ambiente)
    pagina.route("**/api/entrega", lambda rota: rota.fulfill(status=422, json={"erro": "entrega_indisponivel", "mensagem": "Não conseguimos calcular a entrega para esse endereço."}))
    pagina.goto(URL + "/")
    adicionar(pagina, "classico")
    abrir_finalizar(pagina)
    preencher(pagina, "58999-999")
    expect(pagina.get_by_text("Não entregamos nesse endereço pelo site.")).to_be_visible()
    expect(pagina.locator("#entrega-whatsapp")).to_be_visible()
    expect(pagina.get_by_role("button", name="Ir para o pagamento")).to_be_disabled()
    assert pagina.pedidos_mapa == []
    pagina.context.close()
