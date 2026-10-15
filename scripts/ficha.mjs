#!/usr/bin/env node
/**
 * A ficha da release, copiada para dentro do site — sem rede, sem medição aqui.
 *
 * uso: node scripts/ficha.mjs <caminho do shizune-release.json>
 *
 * A release é a fonte, os sites são cópias (DEC-026 no Brain). Cada release do
 * pacote leva anexado um `shizune-release.json`, gerado e conferido por
 * `scripts/ficha-release.mjs` do próprio pacote: o sha é o commit da tag, a tag
 * tem assinatura G, e cada número vem com o comando que o reproduz. Este site lê
 * só esse arquivo. O navegador não busca nada ao vivo — o CSP não deixa.
 *
 * Até a 0.5.0 este script clonava o pacote e media os números aqui. A medição
 * passou para a release, que é o único lugar onde ela é conferida contra a tag;
 * medir de novo aqui seria ter duas fontes para o mesmo número.
 *
 * Quem troca a ficha, em produção, é a cadeia: um workflow agendado lê a release
 * Latest, roda `ficha-release --check` e abre um PR em `preview/*` só com estes
 * dois arquivos. Este script é o mesmo passo, à mão.
 *
 * O que ele faz:
 *   1. confere o mínimo que o site precisa ler (o esquema inteiro é conferido
 *      pela cadeia, com o script do pacote);
 *   2. copia o arquivo BYTE A BYTE para `src/content/ficha-release.json`, para
 *      que o sha256 da cópia seja o mesmo do anexo da release;
 *   3. grava o sha em `src/content/release-mais-recente.json`. A cadeia grava ali
 *      o sha da release mais recente; quando ele diverge do da ficha, as páginas
 *      ligam o aviso "desatualizada".
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(RAIZ, "src/content/ficha-release.json");
const MAIS_RECENTE = path.join(RAIZ, "src/content/release-mais-recente.json");

const DEGRAUS = [
  "agent-signs-for-owner",
  "poisoned-index-or-memory",
  "forged-attestation",
  "tampered-generated-rules",
  "approval-on-autopilot",
  "long-lived-leaked-key",
];
const AFIRMACOES = ["negative-test-assertions", "doctor-summary", "package-files", "negative-test-output"];

function recusar(msg) {
  console.error(`ficha: ${msg}`);
  process.exit(1);
}

const origem = process.argv[2];
if (!origem) recusar("diga o caminho do shizune-release.json da release.");

const bytes = readFileSync(origem);
let ficha;
try {
  const texto = bytes.toString("utf8");
  // Um BOM no começo não é conteúdo: sai antes da leitura, comparado pelo código.
  ficha = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
} catch (e) {
  recusar(`o arquivo não é JSON: ${e.message}`);
}

const problemas = [];
if (ficha.schema !== "shizune.release/v1") problemas.push(`schema "${ficha.schema}", esperado shizune.release/v1`);
if (!/^[0-9a-f]{40}$/.test(ficha.sha ?? "")) problemas.push("sha não tem 40 hex");
if (!/^\d{4}-\d{2}-\d{2}$/.test(ficha.date ?? "")) problemas.push("date não é AAAA-MM-DD");
const ids = (ficha.steps ?? []).map((s) => s.id).join(",");
if (ids !== DEGRAUS.join(",")) problemas.push("steps não traz os seis degraus, na ordem");
const temAfirmacao = new Set((ficha.evidence ?? []).map((e) => e.id));
for (const id of AFIRMACOES) if (!temAfirmacao.has(id)) problemas.push(`falta a afirmação ${id}`);
if (problemas.length) recusar(`a ficha não serve ao site:\n  ${problemas.join("\n  ")}`);

// Aviso, e não recusa: a ficha é a que a release publicou, e o site copia o que
// está publicado. Uma captura com bloco pulado se corrige na release.
const captura = ficha.evidence.find((e) => e.id === "negative-test-output")?.capture ?? "";
const pulados = captura.split("\n").filter((l) => /^\s*n\/a\s/.test(l));
if (pulados.length) {
  console.warn(
    `ficha: aviso — a captura do teste negativo tem ${pulados.length} bloco(s) que não rodaram:\n` +
      pulados.map((l) => `  ${l.trim()}`).join("\n") +
      "\n  A página vai mostrar isso como está. A correção é trocar o anexo da release.",
  );
}

writeFileSync(DESTINO, bytes);
writeFileSync(MAIS_RECENTE, `${JSON.stringify({ sha: ficha.sha }, null, 2)}\n`, "utf8");

const sha256 = createHash("sha256").update(bytes).digest("hex");
console.log(
  `ficha: copiada (${bytes.length} bytes, sha256 ${sha256}), commit da release ${ficha.sha.slice(0, 7)}, ` +
    `data ${ficha.date}. Resultado: OK`,
);
