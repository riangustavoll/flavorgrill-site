// Antes de cada arquivo de teste: aplica as migrações no banco de teste (isolado por teste).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.MIGRACOES_TESTE);
