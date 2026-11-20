import { describe, it, expect } from "vitest";
import dados from "../public/js/dados.js";
import { calcularItens, ErroPedido } from "../worker/pedido.js";

function erroDe(linhas) {
    try {
        calcularItens(linhas);
    } catch (erro) {
        expect(erro).toBeInstanceOf(ErroPedido);
        return erro.codigo;
    }
    return null;
}

describe("cálculo do pedido no servidor", () => {
    it("F Clássico avulso custa 2490 centavos", () => {
        const resultado = calcularItens([{ id: "classico", quantidade: 1 }]);
        expect(resultado.subtotal).toBe(2490);
        expect(resultado.temCombo).toBe(false);
    });

    it("soma combo individual e adicionais no preço unitário", () => {
        const { itens, subtotal, temCombo } = calcularItens([{ id: "classico", quantidade: 2, combo: true, adicionais: ["cheddar"] }]);
        expect(itens[0].unitario).toBe(2490 + 2000 + 500);
        expect(subtotal).toBe(2 * 4990);
        expect(temCombo).toBe(true);
        expect(itens[0].descricao).toBe("2× F Clássico (combo) · Cheddar cremoso");
    });

    it("cobra o acréscimo do F Prime no Combo Casal", () => {
        const resultado = calcularItens([{ id: "combo-casal", quantidade: 1, burguers: ["prime", "prime"] }]);
        expect(resultado.subtotal).toBe(8990 + 2400);
        expect(resultado.temCombo).toBe(true);
    });

    it("recusa escolhas inválidas", () => {
        expect(erroDe([{ id: "combo-casal", quantidade: 1, burguers: ["prime"] }])).toBe("burguers_invalidos");
        expect(erroDe([{ id: "combo-casal", quantidade: 1, burguers: ["prime", "batata"] }])).toBe("burguers_invalidos");
        expect(erroDe([{ id: "x", quantidade: 1 }])).toBe("item_inexistente");
        expect(erroDe([{ id: "classico", quantidade: 0 }])).toBe("quantidade_invalida");
        expect(erroDe([{ id: "classico", quantidade: 51 }])).toBe("quantidade_invalida");
        expect(erroDe([{ id: "classico", quantidade: 1.5 }])).toBe("quantidade_invalida");
        expect(erroDe([{ id: "coca-lata", quantidade: 1, combo: true }])).toBe("combo_invalido");
        expect(erroDe([{ id: "batata", quantidade: 1, adicionais: ["cheddar"] }])).toBe("adicional_invalido");
        expect(erroDe([{ id: "classico", quantidade: 1, adicionais: ["cheddar", "cheddar"] }])).toBe("adicional_invalido");
        expect(erroDe([])).toBe("sacola_vazia");
        expect(erroDe(Array.from({ length: 31 }, () => ({ id: "classico", quantidade: 1 })))).toBe("sacola_grande");
    });

    it("corta a observação em 140 caracteres", () => {
        const { itens } = calcularItens([{ id: "classico", quantidade: 1, observacao: "a".repeat(300) }]);
        expect(itens[0].observacao).toHaveLength(140);
    });

    it("cobra o mesmo preço do cardápio do site em todos os itens", () => {
        for (const categoria of dados.CATEGORIAS) {
            for (const item of categoria.itens) {
                const burguers = item.escolherBurguers ? Array(item.escolherBurguers).fill(item.burguersPermitidos[0]) : undefined;
                const { subtotal } = calcularItens([{ id: item.id, quantidade: 1, burguers }]);
                expect(subtotal, item.id).toBe(Math.round(item.preco * 100));
            }
        }
    });
});
