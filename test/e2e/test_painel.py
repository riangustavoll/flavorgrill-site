"""Painel: pedidos chegando, troca de status, papéis, sem conexão, contraste e toque."""
import os, time
from playwright.sync_api import sync_playwright, expect
from servidor import Servidor, preparar_banco, sql, URL

CONTRASTE = open(os.path.join(os.path.dirname(__file__), "contraste.js")).read()


def inserir_pago(codigo, total=5490):
    agora = int(time.time() * 1000)
    sql(f"""INSERT INTO pedidos (codigo, status, criado_em, expira_em, pago_em, cliente_nome, cliente_whatsapp, endereco_json,
        itens_json, observacoes, subtotal, desconto, entrega, total, metodo, atualizado_em) VALUES ('{codigo}', 'pago', {agora}, {agora + 1020000},
        {agora}, 'Ana Souza', '83999998888', '{{"cep":"58055000","rua":"Rua das Flores","numero":"10","bairro":"Mangabeira","referencia":"Portão azul"}}',
        '[{{"descricao":"1× F Bacon (combo) · Cheddar cremoso","observacao":"sem cebola"}}]', 'Tocar a campainha', {total}, 0, 0, {total}, 'pix', {agora})""")


def checar_contraste_e_toque(pagina, raiz="body"):
    falhas = pagina.evaluate("(" + CONTRASTE + ")()")
    assert falhas == [], falhas
    pequenos = pagina.evaluate("""raiz => [...document.querySelector(raiz).querySelectorAll('button, a, input[type=checkbox], [role=tab]')]
        .map(e => e.matches("input[type=checkbox]") ? (e.closest("label") || e) : e)
        .filter(e => e.offsetParent && e.getBoundingClientRect().height < 44)
        .map(e => e.textContent.trim() || e.outerHTML.slice(0, 60))""", raiz)
    assert pequenos == [], pequenos


def test_dono():
    preparar_banco()
    with Servidor(), sync_playwright() as p:
        navegador = p.chromium.launch()
        contexto = navegador.new_context(viewport={"width": 390, "height": 844})
        pagina = contexto.new_page()
        pagina.goto(URL + "/painel/")
        expect(pagina.get_by_text("dono@flavorgrill.test")).to_be_visible()
        for aba in ["Pedidos", "Cupons", "Resumo", "Equipe"]:
            expect(pagina.get_by_role("tab", name=aba)).to_be_visible()

        inserir_pago("FGE2E01")
        cartao = pagina.locator("[data-codigo=FGE2E01]")
        expect(cartao).to_be_visible(timeout=17000)
        expect(cartao).to_contain_text("1× F Bacon (combo) · Cheddar cremoso")
        expect(cartao).to_contain_text("Rua das Flores, 10")
        expect(cartao.get_by_role("link", name="Chamar no WhatsApp")).to_have_attribute("href", "https://wa.me/5583999998888")
        checar_contraste_e_toque(pagina)

        cartao.get_by_role("button", name="Em preparo").click()
        expect(cartao).to_contain_text("Em preparo")
        expect(cartao.get_by_role("button", name="Saiu para entrega")).to_be_visible()

        pagina.get_by_role("switch", name="Loja aberta").click()
        expect(pagina.get_by_role("switch", name="Loja aberta")).to_have_attribute("aria-checked", "true")
        assert sql("SELECT valor FROM config WHERE chave='loja_aberta'")[0]["valor"] == "1"

        pagina.get_by_role("tab", name="Resumo").click()
        expect(pagina.locator("#resumo")).to_contain_text("R$ 54,90")
        pagina.get_by_role("tab", name="Cupons").click()
        expect(pagina.locator("#cupons")).to_contain_text("FLAVOR10")
        checar_contraste_e_toque(pagina)

        # Sem conexão: aparece o aviso; ao voltar, some e não toca de novo para pedidos já vistos
        pagina.get_by_role("tab", name="Pedidos").click()
        avisos = pagina.evaluate("document.body.dataset.avisos")
        contexto.set_offline(True)
        expect(pagina.get_by_text("Sem conexão, tentando de novo…")).to_be_visible(timeout=17000)
        contexto.set_offline(False)
        expect(pagina.get_by_text("Sem conexão, tentando de novo…")).to_be_hidden(timeout=17000)
        assert pagina.evaluate("document.body.dataset.avisos") == avisos
        navegador.close()


def test_equipe_nao_ve_abas_do_dono():
    with Servidor(ACESSO_DEV_EMAIL="cozinha@flavorgrill.test"), sync_playwright() as p:
        sql("INSERT OR REPLACE INTO equipe (email, papel, criado_em) VALUES ('cozinha@flavorgrill.test', 'equipe', 0)")
        navegador = p.chromium.launch()
        pagina = navegador.new_page(viewport={"width": 390, "height": 844})
        pagina.goto(URL + "/painel/")
        expect(pagina.get_by_role("tab", name="Pedidos")).to_be_visible()
        for aba in ["Cupons", "Resumo", "Equipe"]:
            expect(pagina.get_by_role("tab", name=aba)).to_have_count(0)
        expect(pagina.locator("[data-codigo=FGE2E01]").get_by_role("button", name="Cancelar")).to_have_count(0)
        navegador.close()


def test_email_sem_acesso():
    with Servidor(ACESSO_DEV_EMAIL="estranho@gmail.com"), sync_playwright() as p:
        navegador = p.chromium.launch()
        pagina = navegador.new_page()
        pagina.goto(URL + "/painel/")
        expect(pagina.get_by_text("Seu e-mail não tem acesso. Peça ao dono para adicionar.")).to_be_visible()
        navegador.close()
