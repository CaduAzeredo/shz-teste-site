#!/usr/bin/env node
/**
 * O pacote de teste da cadeia (o P7 do roteiro), em um comando.
 *
 * uso: node scripts/pacote-de-teste.mjs                  (= --plano: só lê e mostra o que vai fazer)
 *      node scripts/pacote-de-teste.mjs --prepara        (cria o repositório, clona, escreve o CHANGELOG)
 *      node scripts/pacote-de-teste.mjs --versao 9.0.0   (um ciclo: commit, tag, ficha, push, release)
 *
 * Funciona igual no PowerShell e no Git Bash. Não tem dependência.
 *
 * O que é o pacote de teste: uma cópia do pacote real, em outro repositório
 * (`CaduAzeredo/shz-teste-pacote`), com quatro versões que nunca vão existir
 * no pacote de verdade. Cada versão é um caso da tabela "A ordem dos testes no
 * GitHub" do roteiro (Brain, `projects/brain-launch/cadeia/roteiro-dos-oito.md`):
 *
 *   9.0.0  release publicada (--latest)     controle A, controle B, testes 4 e 5
 *   9.0.1  release em draft (--draft)       teste 1
 *   9.0.2  pre-release (--prerelease)       teste 2
 *   9.0.3  publicada, ficha ADULTERADA      teste 8: o `sha` da ficha é o da v9.0.0
 *
 * A ordem de um ciclo é commit assinado, tag assinada, ficha, push, release. A
 * ficha vem ANTES do push (o roteiro à mão tinha o push antes): se ela não
 * sair, nada chegou ao GitHub, e desfazer é local.
 *
 * A senha da chave: o script nunca lê, guarda nem recebe. Quem pede é o git (ou
 * o ssh-agent), no próprio terminal, porque o git roda com a entrada e a saída
 * do terminal. O script só pede um "sim" antes de assinar.
 *
 * Recusas (param antes de qualquer escrita do passo):
 *   - o repositório de destino é o pacote real (CaduAzeredo/shizune), pelo nome
 *     ou pelo remoto do clone;
 *   - a tag da versão já existe, no clone ou no remoto;
 *   - a ficha não sai com "ficha-release: ok";
 *   - a captura do teste negativo na ficha traz bloco "n/a" (bloco que não
 *     rodou). O "n/a" do resumo do doctor ("8 passaram, 2 n/a") é a contagem
 *     normal dentro de um pacote e não é recusa.
 *
 * Opções para o ensaio local (scripts/ensaio-pacote-de-teste.mjs), que roda o
 * script inteiro sem GitHub nem rede:
 *   --clone <pasta>    em vez de D:\Dev\shz-teste-pacote
 *   --fichas <pasta>   em vez de D:\Dev\shz-teste-fichas
 *   --origem <url>     de onde clonar, em vez do pacote real no GitHub
 *   --remoto <url>     o remoto do clone, em vez do repositório no GitHub
 *   --sem-github       não chama o `gh`: mostra o comando e segue
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PACOTE_REAL = "CaduAzeredo/shizune";
export const SITE = "CaduAzeredo/shz-teste-site";
const REPO = "CaduAzeredo/shz-teste-pacote";
const DEGRAU_AGORA = "poisoned-index-or-memory";

export const VERSOES = {
  "9.0.0": { release: "--latest", caso: "controle A (depois: controle B, testes 4 e 5)" },
  "9.0.1": { release: "--draft", caso: "teste 1 (release em draft não dispara)" },
  "9.0.2": { release: "--prerelease", caso: "teste 2 (pre-release não dispara)" },
  "9.0.3": { release: "--latest", caso: "teste 8 (ficha com o sha de outro commit)", adulterar: true },
};

// ── argumentos ──────────────────────────────────────────────────────────────

function lerArgs(argv) {
  const o = { modo: "plano" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plano") o.modo = "plano";
    else if (a === "--prepara") o.modo = "prepara";
    else if (a === "--versao") (o.modo = "versao"), (o.versao = argv[++i]);
    else if (a === "--sem-github") o.semGithub = true;
    else if (["--clone", "--fichas", "--origem", "--remoto", "--repo"].includes(a)) o[a.slice(2)] = argv[++i];
    else recusar(`opção desconhecida: ${a}`);
  }
  o.repo ??= REPO;
  o.clone ??= "D:/Dev/shz-teste-pacote";
  o.fichas ??= "D:/Dev/shz-teste-fichas";
  o.origem ??= `https://github.com/${PACOTE_REAL}.git`;
  o.remoto ??= `https://github.com/${o.repo}.git`;
  return o;
}

function recusar(msg) {
  console.error(`\npacote-de-teste: RECUSADO — ${msg}`);
  process.exit(1);
}

/** O nome `dono/repo` de uma URL do GitHub, em minúsculas; null se não for do GitHub. */
export function nomeNoGithub(url) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Verdadeiro se `dono/repo` ou a URL apontam para o pacote real. Caminho local nunca é. */
export function ehPacoteReal(repoOuUrl) {
  const s = String(repoOuUrl ?? "").trim();
  const nome = /^[\w.-]+\/[\w.-]+$/.test(s) ? s.toLowerCase().replace(/\.git$/, "") : nomeNoGithub(s);
  return nome === PACOTE_REAL.toLowerCase();
}

/** As linhas da captura do teste negativo que dizem "n/a" (bloco que não rodou). */
export function blocosNA(ficha) {
  const captura = (ficha.evidence ?? []).find((e) => e.id === "negative-test-output")?.capture ?? "";
  return captura.split("\n").filter((l) => /^\s*n\/a\s/.test(l));
}

// ── processos ───────────────────────────────────────────────────────────────

/** Roda e devolve a saída. `terminal: true` liga o processo ao terminal (prompt da senha). */
function rodar(cmd, args, { cwd, terminal = false, aceitarFalha = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: terminal ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) recusar(`não consegui rodar ${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !aceitarFalha) {
    recusar(`${cmd} ${args.join(" ")} saiu com ${r.status}.\n${(r.stderr ?? "").trim()}`);
  }
  // trimEnd, e não trim: a primeira linha do `git status --porcelain` começa com espaço (" M arquivo")
  return { status: r.status, out: (r.stdout ?? "").trimEnd(), err: (r.stderr ?? "").trim() };
}
const git = (cwd, ...args) => rodar("git", ["-C", cwd, ...args]);
const gitTalvez = (cwd, ...args) => rodar("git", ["-C", cwd, ...args], { aceitarFalha: true });

function gh(o, args, { terminal = false } = {}) {
  if (o.semGithub) {
    console.log(`  [sem-github] gh ${args.join(" ")}`);
    return { status: 0, out: "", err: "" };
  }
  return rodar("gh", args, { terminal, aceitarFalha: false });
}

function perguntar(texto) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, (r) => {
      rl.close();
      resolve(r.trim().toLowerCase());
    });
  });
}

// ── o estado ────────────────────────────────────────────────────────────────

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function secao(versao, data) {
  return `## [${versao}] - ${data}\n\nTest release for the chain. Not a real version.\n\n`;
}

function secoesNoChangelog(clone) {
  const p = path.join(clone, "CHANGELOG.md");
  if (!existsSync(p)) return null;
  const texto = readFileSync(p, "utf8");
  const achadas = {};
  for (const v of Object.keys(VERSOES)) {
    const m = new RegExp(`^## \\[${v.replace(/\./g, "\\.")}\\] - (\\d{4}-\\d{2}-\\d{2})`, "m").exec(texto);
    if (m) achadas[v] = m[1];
  }
  return achadas;
}

function guardarRemoto(o) {
  if (ehPacoteReal(o.repo)) recusar(`o destino é ${o.repo}, o pacote real. O pacote de teste nunca escreve lá.`);
  if (ehPacoteReal(o.remoto)) recusar(`o remoto ${o.remoto} é o pacote real.`);
  if (existsSync(path.join(o.clone, ".git"))) {
    const url = gitTalvez(o.clone, "remote", "get-url", "--push", "origin").out;
    if (ehPacoteReal(url)) recusar(`o remoto de push do clone (${url}) é o pacote real. Troque com: git -C ${o.clone} remote set-url origin ${o.remoto}`);
  }
}

function comandoDaCadeia(o, versao) {
  const run = `gh workflow run cadeia-ficha.yml --repo ${SITE} -f pacote=${o.repo}`;
  const ver = `gh run watch --repo ${SITE}`;
  const prs = `gh pr list --repo ${SITE} --state all --search "Ficha da release"`;
  const linhas = {
    "9.0.0": [
      "Controle A — a cadeia abre o PR da v9.0.0:",
      `  ${run}`,
      `  ${ver}`,
      `  ${prs}`,
      "  Tem de acontecer: run verde; PR \"Ficha da release v9.0.0\" de preview/ficha-v9.0.0; o diff só nos dois arquivos de src/content/.",
      `  Onde ler: gh pr diff <n> --repo ${SITE} --name-only`,
      "Controle B — o mesmo comando de novo:",
      `  ${run}`,
      "  Tem de acontecer: run verde, com \"o ramo preview/ficha-v9.0.0 já existe\"; nenhum PR novo.",
      "Testes 4 e 5 — a sonda, com o número do PR do controle A:",
      `  gh workflow run sonda-token.yml --repo ${SITE} -f pr=<n>`,
      "  Tem de acontecer: run verde; os passos \"teste 5\" e \"teste 4\" dizem \"passou\"; o PR segue aberto.",
    ],
    "9.0.1": [
      "Teste 1 — a release em draft não dispara:",
      `  ${run}`,
      `  ${ver}`,
      "  Tem de acontecer: o run lê a Latest (v9.0.0) e termina com \"já existe\".",
      `  Onde ler: o log do run; gh pr list --repo ${SITE} --state all --search v9.0.1 (vazio)`,
    ],
    "9.0.2": [
      "Teste 2 — a pre-release não dispara:",
      `  ${run}`,
      `  ${ver}`,
      "  Tem de acontecer: o run lê a Latest (v9.0.0) e termina com \"já existe\".",
      `  Onde ler: o log do run; gh pr list --repo ${SITE} --state all --search v9.0.2 (vazio)`,
    ],
    "9.0.3": [
      "Teste 8 — a ficha adulterada não passa da conferência:",
      `  ${run}`,
      `  ${ver}`,
      "  Tem de acontecer: run vermelho em \"conferir a ficha\", com \"sha: a ficha diz …, a tag v9.0.3 aponta para …\". Nenhum PR.",
      `  Onde ler: gh run view --repo ${SITE} --log-failed`,
      "Depois, a Latest volta para a v9.0.0:",
      `  gh release edit v9.0.0 --repo ${o.repo} --latest`,
    ],
  };
  return linhas[versao].join("\n");
}

// ── os modos ────────────────────────────────────────────────────────────────

function plano(o) {
  guardarRemoto(o);
  const temClone = existsSync(path.join(o.clone, ".git"));
  const secoes = temClone ? secoesNoChangelog(o.clone) ?? {} : {};
  const tags = temClone ? new Set(gitTalvez(o.clone, "tag", "--list", "v9.0.*").out.split("\n").filter(Boolean)) : new Set();
  let repoExiste = "não conferido (--sem-github)";
  if (!o.semGithub) {
    const r = rodar("gh", ["repo", "view", o.repo, "--json", "name"], { aceitarFalha: true });
    repoExiste = r.status === 0 ? "existe" : "não existe (o --prepara cria)";
  }

  console.log("pacote-de-teste — o plano (nada foi escrito)\n");
  console.log(`  repositório de destino   ${o.repo}: ${repoExiste}`);
  console.log(`  clone                    ${o.clone}: ${temClone ? "existe" : "não existe (o --prepara clona de " + o.origem + ")"}`);
  console.log(`  remoto do clone          ${o.remoto}`);
  console.log(`  fichas                   ${path.join(o.fichas, "v9.0.X", "shizune-release.json")}`);
  console.log(`  CHANGELOG                ${Object.keys(secoes).length} de 4 seções 9.0.x escritas`);
  console.log("");
  console.log("  --prepara: cria o repositório (se não existir), clona, troca o remoto e escreve as");
  console.log("             quatro seções no CHANGELOG.md. Sem commit, sem tag, sem release.");
  console.log("");
  console.log("  --versao, uma de cada vez e nesta ordem:");
  for (const [v, d] of Object.entries(VERSOES)) {
    const feita = tags.has(`v${v}`) ? "  [tag já existe: recusa]" : "";
    console.log(`    ${v}  release ${d.release.padEnd(13)} ${d.caso}${d.adulterar ? " — o sha da ficha vira o da v9.0.0" : ""}${feita}`);
  }
  console.log("");
  console.log("  Cada ciclo: commit -S, tag -s, ficha (gerada na tag), push, release. Pede \"sim\" antes de assinar.");
  console.log("  A senha da chave é pedida pelo git, no terminal; o script não a vê.");
  console.log(`\n  Próximo passo: node scripts/pacote-de-teste.mjs ${temClone ? "--versao " + (Object.keys(VERSOES).find((v) => !tags.has(`v${v}`)) ?? "(todas feitas)") : "--prepara"}`);
}

function prepara(o) {
  guardarRemoto(o);
  console.log("pacote-de-teste — preparação\n");

  if (o.semGithub) {
    gh(o, ["repo", "create", o.repo, "--public", "--description", "Test package for the Shizune release-to-site chain. Not a real package."]);
  } else {
    const r = rodar("gh", ["repo", "view", o.repo, "--json", "name"], { aceitarFalha: true });
    if (r.status === 0) console.log(`  ${o.repo} já existe no GitHub.`);
    else {
      rodar("gh", ["repo", "create", o.repo, "--public", "--description", "Test package for the Shizune release-to-site chain. Not a real package."], { terminal: true });
      console.log(`  ${o.repo} criado, público.`);
    }
  }

  if (existsSync(path.join(o.clone, ".git"))) {
    console.log(`  o clone ${o.clone} já existe.`);
  } else {
    if (existsSync(o.clone)) recusar(`${o.clone} existe e não é um clone git. Nada foi escrito nele.`);
    rodar("git", ["clone", "--quiet", o.origem, o.clone]);
    console.log(`  clonado de ${o.origem} em ${o.clone}.`);
  }
  git(o.clone, "remote", "set-url", "origin", o.remoto);
  guardarRemoto(o);
  console.log(`  remoto origin: ${git(o.clone, "remote", "get-url", "origin").out}`);

  const p = path.join(o.clone, "CHANGELOG.md");
  if (!existsSync(p)) recusar("o clone não tem CHANGELOG.md.");
  const achadas = secoesNoChangelog(o.clone);
  const n = Object.keys(achadas).length;
  if (n === 4) {
    console.log("  o CHANGELOG.md já tem as quatro seções 9.0.x.");
  } else if (n > 0) {
    recusar(`o CHANGELOG.md tem ${n} das 4 seções 9.0.x. Confira à mão antes de seguir.`);
  } else {
    const texto = readFileSync(p, "utf8");
    const i = texto.search(/^## \[\d/m);
    if (i < 0) recusar("não achei a primeira seção de versão (## [N…]) no CHANGELOG.md.");
    const data = hoje();
    const novas = Object.keys(VERSOES).reverse().map((v) => secao(v, data)).join("");
    const eol = texto.includes("\r\n") ? "\r\n" : "\n";
    writeFileSync(p, texto.slice(0, i) + novas.replace(/\n/g, eol) + texto.slice(i));
    console.log(`  CHANGELOG.md: as quatro seções 9.0.3 a 9.0.0, datadas de ${data}, acima da ${texto.slice(i).split(/\r?\n/)[0]}.`);
  }
  console.log("\n  Sem commit, sem tag, sem release. Próximo passo: node scripts/pacote-de-teste.mjs --versao 9.0.0");
  console.log("pacote-de-teste: Resultado: OK");
}

async function versao(o) {
  const v = o.versao;
  const d = VERSOES[v];
  if (!d) recusar(`versão "${v}" fora da lista: ${Object.keys(VERSOES).join(", ")}.`);
  guardarRemoto(o);
  if (!existsSync(path.join(o.clone, ".git"))) recusar(`o clone ${o.clone} não existe. Rode o --prepara antes.`);

  const tag = `v${v}`;
  if (gitTalvez(o.clone, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`).status === 0) {
    recusar(`a tag ${tag} já existe no clone. Cada versão roda uma vez só.`);
  }
  const remota = gitTalvez(o.clone, "ls-remote", "--tags", "origin", `refs/tags/${tag}`);
  if (remota.status !== 0) recusar(`não consegui ler as tags do remoto (${o.remoto}).\n${remota.err}`);
  if (remota.out) recusar(`a tag ${tag} já existe no remoto.`);

  const anteriores = Object.keys(VERSOES).slice(0, Object.keys(VERSOES).indexOf(v));
  const faltam = anteriores.filter((a) => gitTalvez(o.clone, "rev-parse", "--verify", "--quiet", `refs/tags/v${a}`).status !== 0);
  if (faltam.length) recusar(`as versões vão em ordem, e falta(m) antes: ${faltam.join(", ")}.`);

  const ramo = git(o.clone, "rev-parse", "--abbrev-ref", "HEAD").out;
  if (ramo !== "main") recusar(`o clone está no ramo "${ramo}", e o ciclo roda no main.`);
  const mudados = git(o.clone, "status", "--porcelain", "--untracked-files=no").out.split("\n").filter(Boolean);
  const fora = mudados.filter((l) => l.slice(3) !== "CHANGELOG.md");
  if (fora.length) recusar(`há arquivo versionado mudado além do CHANGELOG.md:\n  ${fora.join("\n  ")}`);
  const data = secoesNoChangelog(o.clone)?.[v];
  if (!data) recusar(`o CHANGELOG.md não tem a seção "## [${v}] - AAAA-MM-DD". Rode o --prepara.`);

  const pastaFicha = path.join(o.fichas, tag);
  const arquivoFicha = path.join(pastaFicha, "shizune-release.json");

  console.log(`pacote-de-teste — ciclo da ${tag}: ${d.caso}\n`);
  console.log(`  1. commit assinado no main do clone (${mudados.length ? "com o CHANGELOG.md" : "vazio: as seções já estão no histórico"})`);
  console.log(`  2. tag assinada ${tag}`);
  console.log(`  3. ficha gerada na tag (data ${data}), em ${arquivoFicha}${d.adulterar ? "\n     e ADULTERADA DE PROPÓSITO: o sha vira o commit da v9.0.0 (teste 8)" : ""}`);
  console.log(`  4. push do main e da ${tag} para ${o.remoto}`);
  console.log(`  5. release ${tag} em ${o.repo}, com ${d.release}`);
  console.log("\n  A chave pede a senha no passo 1 e no 2, pelo git, neste terminal (ou o ssh-agent responde).");
  const resposta = await perguntar("  Para assinar e seguir, digite sim: ");
  if (resposta !== "sim") recusar("sem o \"sim\", nada foi feito.");

  // 1 e 2: a assinatura. O git fala com o terminal; a senha nunca passa por aqui.
  rodar("git", ["-C", o.clone, "commit", "-S", "--allow-empty", "-a", "-m", `test: ${v} (bancada da cadeia)`], { terminal: true });
  rodar("git", ["-C", o.clone, "tag", "-s", tag, "-m", `${tag} (teste)`], { terminal: true });
  const commit = git(o.clone, "rev-parse", `${tag}^{commit}`).out;
  const letra = git(o.clone, "log", "-1", "--format=%G?", commit).out;
  console.log(`  commit ${commit.slice(0, 7)}, assinatura %G? = ${letra}`);

  // 3: a ficha, gerada pelo próprio script do pacote, no commit da tag.
  const desfazer =
    `Nada foi enviado. Para desfazer o commit e a tag locais:\n` +
    `  git -C ${o.clone} tag -d ${tag}\n  git -C ${o.clone} reset --soft HEAD~1`;
  const g = rodar(
    process.execPath,
    ["scripts/ficha-release.mjs", "--tag", tag, "--now", DEGRAU_AGORA, "--date", data, "--chain", "todo"],
    { cwd: o.clone, aceitarFalha: true },
  );
  if (g.status !== 0 || !/ficha-release: ok/.test(g.err)) {
    recusar(`a ficha não saiu com "ficha-release: ok".\n${g.err}\n\n${desfazer}`);
  }
  let ficha;
  try {
    ficha = JSON.parse(g.out);
  } catch (e) {
    recusar(`a saída do ficha-release não é JSON: ${e.message}\n\n${desfazer}`);
  }
  const na = blocosNA(ficha);
  if (na.length) recusar(`a captura do teste negativo tem ${na.length} bloco(s) "n/a":\n  ${na.join("\n  ")}\n\n${desfazer}`);
  console.log(`  ${g.err.split("\n").filter((l) => /ficha-release: ok/.test(l)).pop()}`);

  let bytes = `${g.out}\n`;
  if (d.adulterar) {
    const shaV900 = git(o.clone, "rev-parse", "v9.0.0^{commit}").out;
    ficha.sha = shaV900;
    bytes = `${JSON.stringify(ficha, null, 2)}\n`;
    console.log(`  FICHA ADULTERADA DE PROPÓSITO (teste 8): o sha da ficha é ${shaV900.slice(0, 7)} (v9.0.0), e a tag ${tag} aponta para ${commit.slice(0, 7)}.`);
  }
  mkdirSync(pastaFicha, { recursive: true });
  writeFileSync(arquivoFicha, bytes, "utf8");
  console.log(`  ficha gravada em ${arquivoFicha}`);

  // 4: o push. Só depois de a ficha existir.
  rodar("git", ["-C", o.clone, "push", "origin", "main", tag], { terminal: true });
  console.log(`  push do main e da ${tag} feito.`);

  // 5: a release.
  gh(o, ["release", "create", tag, arquivoFicha, "--repo", o.repo, "--title", `${tag} (teste)`, "--notes", "Test release. Not a real version.", d.release], { terminal: true });
  console.log(`  release ${tag} criada com ${d.release}.`);

  console.log(`\n${comandoDaCadeia(o, v)}`);
  console.log("\npacote-de-teste: Resultado: OK");
}

// ── entrada ─────────────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = lerArgs(process.argv.slice(2));
  if (o.modo === "plano") plano(o);
  else if (o.modo === "prepara") prepara(o);
  else await versao(o);
}
