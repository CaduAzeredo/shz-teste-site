#!/usr/bin/env node
/**
 * O portão do site de teste. Roda depois do build, contra `dist/index.html`.
 *
 * uso: node scripts/build.mjs && node scripts/portao.mjs   (ou: bun run portao)
 *
 * Ele confere, no texto visível da página (o corpo, sem `<script>` nem
 * `<style>`), as duas coisas que a cadeia precisa que um site recuse:
 *
 *   1. número divergente (teste 3): cada número que a página afirma tem de ser
 *      o da ficha que está em `src/content/ficha-release.json`. Um número
 *      escrito à mão passa enquanto coincide com a ficha, e reprova na primeira
 *      ficha nova, que é quando a cadeia roda o portão;
 *   2. versão visível (teste 6): nenhum `X.Y.Z` (com ou sem `v`) no texto
 *      visível. A versão vive só no `softwareVersion` do JSON-LD, que tem de
 *      ser a da ficha.
 *
 * É o mesmo par de travas do `e2e` do shizune.dev, sem navegador: aqui o corpo
 * é o HTML que o build gravou, e a página não tem script que mude o texto.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const texto = readFileSync(path.join(RAIZ, "src/content/ficha-release.json"), "utf8");
const ficha = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
const html = readFileSync(path.join(RAIZ, "dist/index.html"), "utf8");

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const corpo = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) ?? [, html])[1];
const visivel = corpo
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e] ?? e)
  .replace(/\s+/g, " ")
  .trim();

const afirmacao = (id) => ficha.evidence.find((e) => e.id === id)?.value;
const NUMEROS = [
  ["arquivos do pacote (package.files)", ficha.package.files],
  ["asserções do teste negativo (negative-test-assertions)", afirmacao("negative-test-assertions")],
  ["data da release (date)", ficha.date],
  ["commit da release (sha, 7 primeiros)", ficha.sha.slice(0, 7)],
];

const falhas = [];
const oks = [];
const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const [nome, valor] of NUMEROS) {
  const achou = new RegExp(`(^|[^0-9A-Za-z])${escapar(valor)}([^0-9A-Za-z]|$)`).test(visivel);
  if (achou) oks.push(`${nome} = ${valor}, como na ficha`);
  else falhas.push(`número divergente: ${nome} — a ficha diz ${valor} e o texto visível não traz esse valor`);
}

const versaoVisivel = visivel.match(/\bv?\d+\.\d+\.\d+\b/g);
if (versaoVisivel) falhas.push(`versão no texto visível: ${[...new Set(versaoVisivel)].join(", ")} (a versão vive só no JSON-LD)`);
else oks.push("nenhuma versão no texto visível");

const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
const softwareVersion = ld ? JSON.parse(ld[1]).softwareVersion : undefined;
if (softwareVersion === ficha.version) oks.push(`JSON-LD softwareVersion = a versão da ficha`);
else falhas.push(`JSON-LD: softwareVersion é ${softwareVersion}, a ficha diz ${ficha.version}`);

if (/\{\{[^}]*\}\}/.test(html)) falhas.push("marca de modelo sem trocar no HTML");

console.log("portão — dist/index.html contra a ficha\n");
for (const o of oks) console.log(`  ok    ${o}`);
for (const f of falhas) console.log(`  FALHA ${f}`);
if (falhas.length) {
  console.log(`\nportão: Resultado: REPROVADO — ${falhas.length} falha(s).`);
  process.exit(1);
}
console.log("\nportão: Resultado: OK");
