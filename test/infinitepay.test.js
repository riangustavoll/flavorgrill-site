import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { criarLink, conferirPagamento, validoAte, ErroPagamento } from "../worker/infinitepay.js";
import { simularFetch } from "./simular-fetch.js";

afterEach(() => vi.restoreAllMocks());

const EXPIRA = Date.UTC(2026, 10, 19, 21, 0);
const PEDIDO = {
    codigo: "FGAB123",
    total: 9690,
    expiraEm: EXPIRA,
    cliente: { nome: "Ana Souza", whatsapp: "83999998888" },
    endereco: { cep: "58055000", rua: "Rua das Flores", numero: "10", bairro: "Mangabeira", referencia: "Portão azul" }
};

const CORPO_ESPERADO = {
    handle: "rian-gustavo",
    items: [{ quantity: 1, price: 9690, description: "Pedido FGAB123 — The Flavor Grill" }],
    order_nsu: "FGAB123",
    redirect_url: "https://flavorgrill.test/?pedido=FGAB123",
    webhook_url: "https://flavorgrill.test/api/infinitepay/webhook",
    customer: { name: "Ana Souza", phone_number: "+5583999998888" },
    address: { cep: "58055000", street: "Rua das Flores", number: "10", neighborhood: "Mangabeira", city: "João Pessoa", state: "PB", complement: "Portão azul" }
};

describe("cliente da InfinitePay", () => {
    it("escreve a validade em horário de Brasília", () => {
        expect(validoAte(EXPIRA)).toBe("2026-11-19T18:00:00-03:00");
    });

    it("cria o link sem chave de API (sem opções avançadas)", async () => {
        const { chamadas } = simularFetch([["/links", { url: "https://checkout.infinitepay.io/abc" }]]);
        expect(await criarLink(env, PEDIDO)).toBe("https://checkout.infinitepay.io/abc");
        expect(chamadas[0].url).toBe("https://api.checkout.infinitepay.io/links");
        expect(chamadas[0].corpo).toEqual(CORPO_ESPERADO);
        expect(chamadas[0].cabecalhos.get("x-api-key")).toBeNull();
    });

    it("com chave de API envia validade de 17 minutos, parcelas pagas pelo cliente e pagamento único", async () => {
        const { chamadas } = simularFetch([["/links", { url: "https://checkout.infinitepay.io/abc" }]]);
        await criarLink({ ...env, INFINITEPAY_API_KEY: "inchk_teste" }, PEDIDO);
        expect(chamadas[0].cabecalhos.get("x-api-key")).toBe("inchk_teste");
        expect(chamadas[0].corpo.options).toEqual({ valid_until: "2026-11-19T18:00:00-03:00", assured_installments: 0, single_payment: true });
    });

    it("falha de criação vira ErroPagamento", async () => {
        simularFetch([["/links", new Response('{"success":false}', { status: 400 })]]);
        await expect(criarLink(env, PEDIDO)).rejects.toBeInstanceOf(ErroPagamento);
        vi.restoreAllMocks();
        simularFetch([["/links", { success: true }]]);
        await expect(criarLink(env, PEDIDO)).rejects.toBeInstanceOf(ErroPagamento);
    });

    it("confere um pagamento aprovado", async () => {
        const { chamadas } = simularFetch([["/payment_check", { success: true, paid: true, amount: 9690, paid_amount: 9690, installments: 1, capture_method: "pix" }]]);
        const resultado = await conferirPagamento(env, { codigo: "FGAB123", transacaoNsu: "t-1", slug: "s-1" });
        expect(resultado).toEqual({ pago: true, valor: 9690, valorPago: 9690, metodo: "pix" });
        expect(chamadas[0].corpo).toEqual({ handle: "rian-gustavo", order_nsu: "FGAB123", transaction_nsu: "t-1", slug: "s-1" });
    });

    it("pagamento não confirmado devolve pago: false", async () => {
        simularFetch([["/payment_check", { success: false, paid: false }]]);
        expect((await conferirPagamento(env, { codigo: "FGAB123", transacaoNsu: "t", slug: "s" })).pago).toBe(false);
    });

    it("erro 503 da InfinitePay vira ErroPagamento", async () => {
        simularFetch([["/payment_check", new Response("indisponível", { status: 503 })]]);
        await expect(conferirPagamento(env, { codigo: "FGAB123", transacaoNsu: "t", slug: "s" })).rejects.toBeInstanceOf(ErroPagamento);
    });
});
