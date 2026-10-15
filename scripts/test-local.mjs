#!/usr/bin/env node
/**
 * Ensaio local da cadeia: roda, numa cópia temporária deste repositório, os
 * passos de verdade do `.github/workflows/cadeia-ficha.yml` — o texto do `run:`
 * de cada passo, lido do próprio YAML, e não uma reescrita dele.
 *
 * uso: node scripts/test-local.mjs            (sem rede: testes 3, 6 e 7a)
 *      node scripts/test-local.mjs --rede     (mais o teste 8 e os controles que
 *                                              leem o pacote público no GitHub)
 *
 * Com --rede, a lista de assinantes vem de ASSINANTES=<arquivo no formato
 * allowed_signers>. Sem ela, os casos com rede são pulados e o ensaio diz isso.
 *
 * O que fica de fora, e por quê: os testes 1, 2, 4 e 5 dependem do GitHub (a
 * API da release Latest com draft e pre-release, e a proteção do `main` contra
 * o GITHUB_TOKEN). Eles rodam depois do push, pelo roteiro em
 * `projects/brain-launch/cadeia/testes-negativos.md` no Brain.
 *
 * A cópia temporária é um repositório git descartável, com um commit-base
 * feito sem assinatura (`commit.gpgsign=false`): o passo "copiar a ficha"
 * compara a árvore com esse commit pelo `git status`, como no runner. Nenhum
 * commit deste ensaio sai da pasta temporária.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { aplicar } from "./preparar-ramo.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(RAIZ, ".github/workflows/cadeia-ficha.yml");
const COM_REDE = process.argv.includes("--rede");
const BASH =
  process.env.BASH_CMD ?? (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");

// ── o texto de um passo, lido do YAML ───────────────────────────────────────

/**
 * Devolve o bloco `run: |` do passo cujo `name:` é `nome`. Lê só a forma que
 * este workflow usa (passo começando em `- name:` ou `- uses:`, `run: |` no
 * passo, corpo indentado). Forma diferente reprova, em vez de adivinhar.
 */
function passo(nome) {
  const linhas = readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
  const i = linhas.findIndex((l) => l.trim() === `- name: ${nome}`);
  if (i < 0) throw new Error(`test-local: o workflow não tem o passo "${nome}"`);
  const recuoPasso = linhas[i].indexOf("-");
  let j = i + 1;
  for (; j < linhas.length; j++) {
    const l = linhas[j];
    if (l.trim() === "") continue;
    const recuo = l.length - l.trimStart().length;
    if (recuo <= recuoPasso) throw new Error(`test-local: o passo "${nome}" não tem "run: |"`);
    if (l.trim() === "run: |") break;
  }
  const recuoRun = linhas[j].length - linhas[j].trimStart().length;
  const corpo = [];
  for (let k = j + 1; k < linhas.length; k++) {
    const l = linhas[k];
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    const recuo = l.length - l.trimStart().length;
    if (recuo <= recuoRun) break;
    corpo.push(l);
  }
  const recuoCorpo = Math.min(...corpo.filter(Boolean).map((l) => l.length - l.trimStart().length));
  return corpo.map((l) => l.slice(recuoCorpo)).join("\n").trimEnd() + "\n";
}

/** O `env:` do job, lido do YAML (só pares `CHAVE: valor` simples). */
function envDoJob() {
  const texto = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n");
  const bloco = /^env:\n((?: {2}.*\n|\s*\n)+)/m.exec(texto)?.[1] ?? "";
  const env = {};
  for (const l of bloco.split("\n")) {
    const m = /^ {2}([A-Z_]+):\s*(.+?)\s*$/.exec(l);
    if (m && !m[2].startsWith("${{")) env[m[1]] = m[2];
  }
  return env;
}

// ── a bancada: uma cópia descartável do repositório ─────────────────────────

const ARQUIVOS = ["package.json", ".gitattributes", ".gitignore", "scripts", "src", ".github"];

function bancada() {
  const dir = mkdtempSync(path.join(tmpdir(), "shz-teste-site-"));
  for (const a of ARQUIVOS) if (existsSync(path.join(RAIZ, a))) cpSync(path.join(RAIZ, a), path.join(dir, a), { recursive: true });
  const git = (...args) => {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  git("init", "--quiet", "-b", "main");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("-c", "user.name=ensaio", "-c", "user.email=ensaio@invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "base do ensaio");
  const temp = path.join(dir, ".runner-temp");
  mkdirSync(path.join(temp, "release"), { recursive: true });
  // o .runner-temp fica fora do git status, como o RUNNER_TEMP fica fora do workspace
  writeFileSync(path.join(dir, ".git/info/exclude"), ".runner-temp/\nnode_modules/\ndist/\n");
  return { dir, temp, git };
}

function rodar(b, nomeDoPasso, extras = {}) {
  const saida = path.join(b.temp, `output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(saida, "");
  const r = spawnSync(BASH, ["-e", "-c", passo(nomeDoPasso)], {
    cwd: b.dir,
    encoding: "utf8",
    // barras normais: o bash do Git no Windows lê `C:/...` sem tropeçar em `\`
    env: {
      ...process.env,
      ...envDoJob(),
      RUNNER_TEMP: b.temp.replace(/\\/g, "/"),
      GITHUB_WORKSPACE: b.dir.replace(/\\/g, "/"),
      GITHUB_OUTPUT: saida.replace(/\\/g, "/"),
      ...extras,
    },
  });
  return { status: r.status, texto: `${r.stdout}${r.stderr}`, output: readFileSync(saida, "utf8") };
}

function portaoDoJob(b) {
  // o passo do portão no job: `bun install --frozen-lockfile` e `bun run portao`
  return rodar(b, "o portão do site, com a ficha nova");
}

// ── fichas ──────────────────────────────────────────────────────────────────

const FICHA_ATUAL = readFileSync(path.join(RAIZ, "src/content/ficha-release.json"));

/** Uma "ficha nova" sintética: outro sha, outro número de arquivos. Só para os passos depois da conferência. */
function fichaNova(b, mudar = (f) => f) {
  const f = JSON.parse(FICHA_ATUAL.toString("utf8"));
  f.sha = "0".repeat(39) + "1";
  f.package.files += 1;
  for (const e of f.evidence) if (e.id === "package-files") e.value = f.package.files;
  const destino = path.join(b.temp, "release/shizune-release.json");
  writeFileSync(destino, `${JSON.stringify(mudar(f), null, 2)}\n`);
  return destino;
}

/** O ramo do caso: a mesma mutação que `scripts/preparar-ramo.mjs` aplica para o teste no GitHub. */
function prepararRamo(b, teste) {
  aplicar(b.dir, teste);
  // a mudança é o "ramo do site de teste" de cada caso: entra no commit-base,
  // como entraria no ramo que o `--ref` aponta
  b.git("add", "-A");
  b.git("-c", "user.name=ensaio", "-c", "user.email=ensaio@invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "ramo do caso");
}

// ── os casos ────────────────────────────────────────────────────────────────

const resultados = [];
function caso(id, descricao, fn) {
  let b;
  try {
    b = bancada();
    const { ok, detalhe } = fn(b);
    resultados.push({ id, descricao, ok, detalhe });
  } catch (e) {
    resultados.push({ id, descricao, ok: false, detalhe: `erro do ensaio: ${e.message}` });
  } finally {
    if (b) rmSync(b.dir, { recursive: true, force: true });
  }
}
const ultimaLinha = (t, re) => (t.split("\n").filter((l) => re.test(l)).pop() ?? "").trim();

caso("controle L1", "a mesma ficha de novo: nada a fazer, sem PR", (b) => {
  writeFileSync(path.join(b.temp, "release/shizune-release.json"), FICHA_ATUAL);
  const r = rodar(b, "copiar a ficha para o site", { TAG: "v0.5.0" });
  return { ok: r.status === 0 && /nada=1/.test(r.output), detalhe: ultimaLinha(r.texto, /Nada a fazer|::error/) };
});

caso("controle L2", "ficha nova: só os dois arquivos mudam, e o portão passa com ela", (b) => {
  fichaNova(b);
  const c = rodar(b, "copiar a ficha para o site", { TAG: "v0.5.1" });
  const mudou = b.git("status", "--porcelain").split("\n").filter(Boolean).map((l) => l.slice(3)).sort().join(" ");
  const p = portaoDoJob(b);
  return {
    ok: c.status === 0 && mudou === "src/content/ficha-release.json src/content/release-mais-recente.json" && p.status === 0,
    detalhe: `mudou: ${mudou}; ${ultimaLinha(p.texto, /Resultado/)}`,
  };
});

caso("teste 3", "número escrito à mão reprova quando a ficha muda", (b) => {
  prepararRamo(b, "teste-3");
  const antes = rodar(b, "o portão do site, com a ficha nova"); // com a ficha atual, o sha à mão coincide
  fichaNova(b);
  rodar(b, "copiar a ficha para o site", { TAG: "v0.5.1" });
  const p = portaoDoJob(b);
  return {
    ok: antes.status === 0 && p.status !== 0 && /número divergente: commit da release/.test(p.texto),
    detalhe: `com a ficha atual: ${antes.status === 0 ? "passa (o sha à mão coincide)" : "reprova"}; com a nova: ${ultimaLinha(p.texto, /FALHA número/)}`,
  };
});

caso("teste 6", "versão no texto visível reprova", (b) => {
  prepararRamo(b, "teste-6");
  fichaNova(b);
  rodar(b, "copiar a ficha para o site", { TAG: "v0.5.1" });
  const p = portaoDoJob(b);
  return { ok: p.status !== 0 && /versão no texto visível/.test(p.texto), detalhe: ultimaLinha(p.texto, /FALHA versão/) };
});

caso("teste 7a", "a cópia que escreve um verbete além da ficha para sem PR", (b) => {
  prepararRamo(b, "teste-7a");
  fichaNova(b);
  const c = rodar(b, "copiar a ficha para o site", { TAG: "v0.5.1" });
  const ok = c.status !== 0 && /mudou além da ficha/.test(c.texto);
  return { ok, detalhe: ok ? ultimaLinha(c.texto, /::error/) : `status ${c.status}: ${c.texto.trim().slice(-400)}` };
});

if (COM_REDE && process.env.ASSINANTES) {
  const comAssinantes = (b) => {
    cpSync(process.env.ASSINANTES, path.join(b.dir, ".github/assinantes-do-pacote"));
  };

  caso("controle R0", "o runner tem ssh-keygen", (b) => {
    const r = rodar(b, "o runner tem ssh-keygen");
    return { ok: r.status === 0, detalhe: r.status === 0 ? "ssh-keygen presente" : ultimaLinha(r.texto, /::error/) };
  });

  caso("controle R1", "a ficha publicada da v0.5.0 confere com a tag (schema, sha, assinatura G)", (b) => {
    comAssinantes(b);
    writeFileSync(path.join(b.temp, "release/shizune-release.json"), FICHA_ATUAL);
    const r = rodar(b, "conferir a ficha (schema, sha da tag, assinatura G)", { TAG: "v0.5.0", PACOTE: "CaduAzeredo/shizune" });
    return { ok: r.status === 0 && /Resultado: OK/.test(r.texto), detalhe: ultimaLinha(r.texto, /Resultado/) };
  });

  caso("teste 8", "ficha cujo sha não é o da tag não passa da conferência", (b) => {
    comAssinantes(b);
    // o commit da tag anterior (anotada: o ^{} é o commit, e não o objeto da tag)
    const pai = spawnSync("git", ["ls-remote", "https://github.com/CaduAzeredo/shizune.git", "refs/tags/v0.4.1^{}"], { encoding: "utf8" })
      .stdout.trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(pai)) throw new Error("não li o commit da v0.4.1 no pacote público");
    const f = JSON.parse(FICHA_ATUAL.toString("utf8"));
    f.sha = pai;
    writeFileSync(path.join(b.temp, "release/shizune-release.json"), `${JSON.stringify(f, null, 2)}\n`);
    const r = rodar(b, "conferir a ficha (schema, sha da tag, assinatura G)", { TAG: "v0.5.0", PACOTE: "CaduAzeredo/shizune" });
    return {
      ok: r.status !== 0 && /sha: a ficha diz/.test(r.texto),
      detalhe: `sha trocado pelo commit da v0.4.1 (${String(pai).slice(0, 7)}): ${ultimaLinha(r.texto, /sha: a ficha diz/)} / ${ultimaLinha(r.texto, /Resultado/)}`,
    };
  });
} else if (COM_REDE) {
  resultados.push({ id: "rede", descricao: "casos com rede", ok: null, detalhe: "pulados: falta ASSINANTES=<arquivo allowed_signers>" });
}

console.log("ensaio local da cadeia — os passos do cadeia-ficha.yml numa cópia temporária\n");
for (const r of resultados) {
  const marca = r.ok === null ? "pulado" : r.ok ? "ok    " : "FALHA ";
  console.log(`  ${marca} ${r.id} — ${r.descricao}\n         ${r.detalhe}`);
}
const falhas = resultados.filter((r) => r.ok === false).length;
console.log(`\ntest-local: ${falhas ? `Resultado: FALHA — ${falhas} caso(s)` : "Resultado: OK"}`);
process.exit(falhas ? 1 : 0);
