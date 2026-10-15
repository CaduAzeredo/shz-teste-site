#!/usr/bin/env node
/**
 * Escreve `.github/assinantes-do-pacote` a partir de um `allowed_signers`.
 *
 * uso: node scripts/assinantes.mjs <caminho do allowed_signers>
 *
 * A cadeia confere a assinatura da tag do pacote contra esta lista. Ela leva
 * só a chave HUMANA: release assinada por chave de máquina tem de reprovar.
 * Por isso o script recusa, em vez de escolher, se o arquivo de origem não tiver
 * exatamente uma linha cujo principal não termina em `@maquina`.
 *
 * O principal sai trocado por `cadu-azeredo`, sem e-mail, porque este
 * repositório é público. A chave pública sai como está. O script não imprime a
 * linha de origem nem o principal original.
 *
 * Quem roda e commita é o dono: a lista de assinantes é a decisão de quem a
 * cadeia aceita.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(RAIZ, ".github/assinantes-do-pacote");

const origem = process.argv[2];
if (!origem) {
  console.error("assinantes: diga o caminho do allowed_signers de origem.");
  process.exit(1);
}

const linhas = readFileSync(origem, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const humanas = linhas.filter((l) => !/@maquina$/.test(l.split(/\s+/)[0]));
if (humanas.length !== 1) {
  console.error(
    `assinantes: esperava exatamente 1 chave humana (principal sem "@maquina"), achei ${humanas.length} em ${linhas.length} linha(s). Nada foi escrito.`,
  );
  process.exit(1);
}

const [, tipo, chave] = humanas[0].split(/\s+/);
if (!/^ssh-ed25519$|^ssh-rsa$|^ecdsa-/.test(tipo ?? "") || !chave) {
  console.error("assinantes: a linha humana não tem o formato <principal> <tipo> <chave>. Nada foi escrito.");
  process.exit(1);
}

writeFileSync(DESTINO, `cadu-azeredo ${tipo} ${chave}\n`, "utf8");
console.log(
  `assinantes: .github/assinantes-do-pacote escrito com 1 chave humana (${tipo}, termina em ${chave.slice(-8)}); ` +
    `${linhas.length - 1} chave(s) de máquina deixadas de fora. Resultado: OK`,
);
