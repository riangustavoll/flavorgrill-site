import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
    const migracoes = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: "./wrangler.jsonc" },
                miniflare: {
                    bindings: {
                        MIGRACOES_TESTE: migracoes,
                        SITE_URL: "https://flavorgrill.test",
                        DONO_EMAIL: "dono@flavorgrill.test",
                        ACCESS_TEAM_DOMAIN: "flavorgrill.cloudflareaccess.com",
                        ACCESS_AUD: "aud-teste"
                    }
                }
            })
        ],
        test: {
            include: ["test/**/*.test.js"],
            setupFiles: ["./test/preparar.js"]
        }
    };
});
