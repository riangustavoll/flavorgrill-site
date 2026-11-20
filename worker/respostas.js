// Resposta JSON padrão da API
export function json(dados, status = 200) {
    return new Response(JSON.stringify(dados), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
}

// Centavos em reais, ex.: 7000 -> "R$ 70,00"
export function reais(centavos) {
    const [inteiro, decimal] = (centavos / 100).toFixed(2).split(".");
    return "R$ " + inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + decimal;
}
