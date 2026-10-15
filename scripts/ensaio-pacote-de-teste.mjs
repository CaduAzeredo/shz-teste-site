#!/usr/bin/env node
/**
 * Ensaio do `scripts/pacote-de-teste.mjs`, sem GitHub e sem rede.
 *
 * uso: node scripts/ensaio-pacote-de-teste.mjs [--origem <clone local do pacote>]
 *
 * Roda o script de verdade (o mesmo arquivo, como processo) numa pasta
 * temporária que se apaga no fim:
 *
 *   - a origem é um clone LOCAL do pacote (padrão: D:/Dev/shizune), só lido;
 *   - o remoto é um repositório git vazio dentro da pasta temporária, no lugar
 *     do `shz-teste-pacote` no GitHub;
 *   - o `gh` não roda (`--sem-github`): o script mostra o comando e segue;
 *   - a assinatura usa uma chave descartável, sem senha, gerada aqui e apagada
 *     no fim, configurada só no clone temporário. O `commit.gpgsign=false`
 *     também fica no clone, mas não muda nada: o script assina com `-S` e `-s`,
 *     que valem por cima da configuração. E sem assinatura a ficha não sai
 *     (o `ficha-release` exige `%G? = G`), que é o caso 3 abaixo.
 *
 * Nenhum caminho deste ensaio chega ao pacote real nem ao GitHub.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blocosNA, ehPacoteReal } from "./pacote-de-teste.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(RAIZ, "scripts/pacote-de-teste.mjs");
const iOrigem = process.argv.indexOf("--origem");
const ORIGEM = iOrigem > 0 ? process.argv[iOrigem + 1] : "D:/Dev/shizune";

const TMP = mkdtempSync(path.join(tmpdir(), "ensaio-pacote-"));
const barra = (p) => p.replace(/\\/g, "/");
const CLONE = barra(path.join(TMP, "clone"));
const FICHAS = barra(path.join(TMP, "fichas"));
const REMOTO = barra(path.join(TMP, "remoto.git"));
const CHAVE = barra(path.join(TMP, "chave"));
const ASSINANTES = barra(path.join(TMP, "assinantes"));
const VAZIO = barra(path.join(TMP, "assinantes-vazio"));
const BASE = ["--clone", CLONE, "--fichas", FICHAS, "--origem", ORIGEM, "--remoto", REMOTO, "--sem-github"];

const resultados = [];
function caso(id, ok, detalhe) {
  resultados.push({ id, ok, detalhe });
}
function roda(cmd, args, { cwd, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, texto: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const script = (args, input) => roda(process.execPath, [SCRIPT, ...BASE, ...args], { input });
const git = (...args) => roda("git", ["-C", CLONE, ...args]);
const ultima = (t, re) => (t.split("\n").filter((l) => re.test(l)).pop() ?? "").trim();
const tagsNoRemoto = () => roda("git", ["-C", REMOTO, "tag", "--list", "v9.0.*"]).texto.split("\n").filter(Boolean);

try {
  // a bancada
  roda("git", ["init", "--quiet", "--bare", REMOTO]);
  const k = roda("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "ensaio", "-f", CHAVE]);
  if (k.status !== 0) throw new Error(`ssh-keygen: ${k.texto}`);
  writeFileSync(ASSINANTES, `ensaio ${readFileSync(`${CHAVE}.pub`, "utf8").trim()}\n`);
  writeFileSync(VAZIO, "");

  // 1. o plano não escreve nada
  const p = script(["--plano"]);
  caso(
    "1 --plano",
    p.status === 0 && !existsSync(CLONE) && !existsSync(FICHAS) && /nada foi escrito/.test(p.texto),
    `saiu ${p.status}; clone ${existsSync(CLONE) ? "CRIADO" : "não criado"}; fichas ${existsSync(FICHAS) ? "CRIADAS" : "não criadas"}`,
  );

  // 2. a preparação: clone, remoto trocado, quatro seções, sem commit nem tag
  const pr = script(["--prepara"]);
  const changelog = existsSync(`${CLONE}/CHANGELOG.md`) ? readFileSync(`${CLONE}/CHANGELOG.md`, "utf8") : "";
  const secoes = (changelog.match(/^## \[9\.0\.\d\] - \d{4}-\d{2}-\d{2}/gm) ?? []).length;
  const status = git("status", "--porcelain").texto.trim();
  const remoto = git("remote", "get-url", "origin").texto.trim();
  caso(
    "2 --prepara",
    pr.status === 0 && secoes === 4 && status === "M CHANGELOG.md" && remoto === REMOTO && tagsNoRemoto().length === 0,
    `saiu ${pr.status}; ${secoes} seções; status "${status}"; origin = remoto temporário: ${remoto === REMOTO}; ${ultima(pr.texto, /\[sem-github\]/)}`,
  );
  const pr2 = script(["--prepara"]);
  caso("2b --prepara de novo", pr2.status === 0 && /já tem as quatro seções/.test(pr2.texto), ultima(pr2.texto, /quatro seções/));

  // a assinatura descartável, só no clone temporário
  for (const [c, v] of [
    ["user.name", "ensaio"],
    ["user.email", "ensaio@invalid"],
    ["gpg.format", "ssh"],
    ["user.signingkey", CHAVE],
    ["commit.gpgsign", "false"],
    ["gpg.ssh.allowedSignersFile", VAZIO],
  ]) git("config", c, v);

  // 3. com a chave fora da lista, a ficha não sai: recusa, e nada chega ao remoto
  const r3 = script(["--versao", "9.0.0"], "sim\n");
  caso(
    "3 assinatura fora da lista",
    r3.status !== 0 && /a ficha não saiu com "ficha-release: ok"/.test(r3.texto) && tagsNoRemoto().length === 0 && /tag -d v9\.0\.0/.test(r3.texto),
    `${ultima(r3.texto, /%G\? =/)}; ${ultima(r3.texto, /RECUSADO/)}; tags no remoto: ${tagsNoRemoto().length}`,
  );
  // desfazer como o script ensina, e pôr a chave na lista
  git("tag", "-d", "v9.0.0");
  git("reset", "--soft", "HEAD~1");
  git("config", "gpg.ssh.allowedSignersFile", ASSINANTES);

  // 4. sem o "sim", nada acontece
  const r4 = script(["--versao", "9.0.0"], "nao\n");
  caso("4 sem o sim", r4.status !== 0 && git("tag", "--list", "v9.0.0").texto.trim() === "", ultima(r4.texto, /RECUSADO/));

  // 5. fora de ordem
  const r5 = script(["--versao", "9.0.3"], "sim\n");
  caso("5 fora de ordem", r5.status !== 0 && /falta\(m\) antes: 9\.0\.0/.test(r5.texto), ultima(r5.texto, /RECUSADO/));

  // 6. os quatro ciclos
  for (const v of ["9.0.0", "9.0.1", "9.0.2", "9.0.3"]) {
    const r = script(["--versao", v], "sim\n");
    const arquivo = `${FICHAS}/v${v}/shizune-release.json`;
    caso(
      `6 ciclo ${v}`,
      r.status === 0 && existsSync(arquivo) && tagsNoRemoto().includes(`v${v}`) && /gh workflow run cadeia-ficha\.yml/.test(r.texto),
      `${ultima(r.texto, /%G\? =/)}; ${ultima(r.texto, /\[sem-github\] gh release/)}${v === "9.0.3" ? `; ${ultima(r.texto, /ADULTERADA DE PROPÓSITO \(/)}` : ""}`,
    );
  }

  // 7. a mesma versão de novo
  const r7 = script(["--versao", "9.0.0"], "sim\n");
  caso("7 tag repetida", r7.status !== 0 && /a tag v9\.0\.0 já existe/.test(r7.texto), ultima(r7.texto, /RECUSADO/));

  // 8. as fichas, conferidas pelo script do próprio pacote, como a cadeia confere
  for (const v of ["9.0.0", "9.0.1", "9.0.2", "9.0.3"]) {
    const c = roda(process.execPath, [`${CLONE}/scripts/ficha-release.mjs`, "--check", `${FICHAS}/v${v}/shizune-release.json`, "--tag", `v${v}`, `--arvore=${CLONE}`]);
    const esperado = v === "9.0.3" ? c.status !== 0 && /sha: a ficha diz/.test(c.texto) : c.status === 0 && /Resultado: OK/.test(c.texto);
    caso(`8 --check v${v}`, esperado, `${ultima(c.texto, /sha: a ficha diz/) || ""} ${ultima(c.texto, /Resultado/)}`.trim());
  }

  // 9. as funções de guarda, direto
  const real = ["CaduAzeredo/shizune", "caduazeredo/Shizune.git", "https://github.com/CaduAzeredo/shizune.git", "git@github.com:CaduAzeredo/shizune.git"];
  const outros = ["CaduAzeredo/shz-teste-pacote", "https://github.com/CaduAzeredo/shz-teste-pacote.git", REMOTO, "D:/Dev/shizune"];
  caso(
    "9 guarda do pacote real",
    real.every(ehPacoteReal) && !outros.some(ehPacoteReal),
    `${real.length} formas do real recusadas; ${outros.length} outras aceitas (inclui o caminho local D:/Dev/shizune, que é só origem de leitura)`,
  );
  const fichaSite = JSON.parse(readFileSync(path.join(RAIZ, "src/content/ficha-release.json"), "utf8"));
  const comNA = structuredClone(fichaSite);
  comNA.evidence.find((e) => e.id === "negative-test-output").capture += "\n  n/a   bloco que não rodou";
  caso("9b guarda do n/a", blocosNA(fichaSite).length === 0 && blocosNA(comNA).length === 1, `ficha do site: ${blocosNA(fichaSite).length} bloco n/a; com um bloco posto: ${blocosNA(comNA).length}`);
} catch (e) {
  caso("ensaio", false, `erro do ensaio: ${e.message}`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`ensaio do pacote-de-teste — origem ${ORIGEM}, remoto e chave temporários, sem GitHub\n`);
for (const r of resultados) console.log(`  ${r.ok ? "ok    " : "FALHA "} ${r.id}\n         ${r.detalhe}`);
const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\npasta temporária apagada: ${!existsSync(TMP)}`);
console.log(`ensaio-pacote-de-teste: ${falhas ? `Resultado: FALHA — ${falhas} caso(s)` : "Resultado: OK"}`);
process.exit(falhas ? 1 : 0);
