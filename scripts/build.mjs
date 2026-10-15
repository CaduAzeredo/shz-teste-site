#!/usr/bin/env node
/**
 * O build do site de teste: uma página, montada da ficha da release.
 *
 * uso: node scripts/build.mjs
 *
 * Este repositório não é um site de verdade. Ele existe para a cadeia
 * release → site ter onde ser testada antes de chegar ao shizune.dev e à
 * caduazeredo.com. Por isso o build faz só o que os oito testes negativos
 * precisam que um site faça:
 *
 *   1. lê `src/content/ficha-release.json` e troca cada `{{ficha:<campo>}}` de
 *      `src/pagina.html` pelo valor da ficha. Um número na página que não passa
 *      por aqui foi escrito à mão, e o portão o pega quando a ficha muda
 *      (teste 3);
 *   2. põe a versão só no JSON-LD (`softwareVersion`), que não é texto visível.
 *      Versão no texto visível reprova no portão (teste 6);
 *   3. liga a faixa "desatualizada" quando o sha de
 *      `src/content/release-mais-recente.json` diverge do sha da ficha, como nos
 *      sites reais.
 *
 * Grava `dist/index.html`. Campo desconhecido no modelo reprova o build, em vez
 * de sair uma página com a marca crua.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lerJson = (rel) => {
  const texto = readFileSync(path.join(RAIZ, rel), "utf8");
  return JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
};

const ficha = lerJson("src/content/ficha-release.json");
const maisRecente = lerJson("src/content/release-mais-recente.json");
const modelo = readFileSync(path.join(RAIZ, "src/pagina.html"), "utf8");

const afirmacao = (id) => ficha.evidence.find((e) => e.id === id)?.value;
const CAMPOS = {
  "package.files": () => ficha.package.files,
  "evidence.negative-test-assertions": () => afirmacao("negative-test-assertions"),
  date: () => ficha.date,
  sha7: () => ficha.sha.slice(0, 7),
};

const desconhecidos = [];
let html = modelo.replace(/\{\{ficha:([a-z0-9.-]+)\}\}/gi, (marca, campo) => {
  const valor = CAMPOS[campo]?.();
  if (valor === undefined || valor === null) {
    desconhecidos.push(campo);
    return marca;
  }
  return String(valor);
});
if (desconhecidos.length) {
  console.error(`build: campo(s) que a ficha não tem: ${desconhecidos.join(", ")}`);
  process.exit(1);
}

const jsonld = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: "shz-teste-site",
  softwareVersion: ficha.version,
};
html = html.replace("{{jsonld}}", `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`);

const desatualizada = maisRecente.sha !== ficha.sha;
html = html.replace(
  "{{faixa}}",
  desatualizada
    ? `<p role="status" data-faixa="desatualizada">This page reads an older release record than the latest release.</p>`
    : "",
);

mkdirSync(path.join(RAIZ, "dist"), { recursive: true });
writeFileSync(path.join(RAIZ, "dist/index.html"), html, "utf8");
console.log(
  `build: dist/index.html montado da ficha ${ficha.sha.slice(0, 7)}` +
    (desatualizada ? " (faixa desatualizada ligada)" : "") +
    ". Resultado: OK",
);
