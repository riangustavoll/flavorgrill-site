-- Banco da The Flavor Grill (Cloudflare D1). Valores em centavos; datas em milissegundos (Date.now()).

CREATE TABLE pedidos (
    codigo TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    expira_em INTEGER NOT NULL,
    pago_em INTEGER,
    cliente_nome TEXT NOT NULL,
    cliente_whatsapp TEXT NOT NULL,
    endereco_json TEXT NOT NULL,
    itens_json TEXT NOT NULL,
    observacoes TEXT,
    cupom_codigo TEXT,
    subtotal INTEGER NOT NULL,
    desconto INTEGER NOT NULL DEFAULT 0,
    entrega INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    distancia_km REAL,
    link_url TEXT,
    valor_pago INTEGER,
    metodo TEXT,
    recibo_url TEXT,
    transacao_nsu TEXT,
    slug TEXT,
    alerta TEXT,
    atualizado_em INTEGER NOT NULL
);
CREATE INDEX pedidos_whatsapp_status ON pedidos (cliente_whatsapp, status);
CREATE INDEX pedidos_status_pago ON pedidos (status, pago_em);

CREATE TABLE cupons (
    codigo TEXT PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('porcentagem', 'fixo')),
    valor INTEGER NOT NULL,
    minimo INTEGER NOT NULL DEFAULT 0,
    primeira_compra INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    valido_ate INTEGER,
    limite_usos INTEGER
);
INSERT INTO cupons (codigo, tipo, valor, minimo, primeira_compra) VALUES
    ('FLAVOR10', 'porcentagem', 10, 7000, 0),
    ('BEMVINDO', 'fixo', 500, 0, 1);

CREATE TABLE equipe (
    email TEXT PRIMARY KEY,
    papel TEXT NOT NULL CHECK (papel IN ('dono', 'equipe')),
    criado_em INTEGER NOT NULL
);

CREATE TABLE config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
INSERT INTO config (chave, valor) VALUES ('loja_aberta', '0');

CREATE TABLE ceps (
    cep TEXT PRIMARY KEY,
    distancia_km REAL NOT NULL,
    atualizado_em INTEGER NOT NULL
);
