#!/usr/bin/env node
/**
 * Prepara, na árvore de trabalho, o ramo de um teste negativo da cadeia.
 *
 * uso: node scripts/preparar-ramo.mjs <teste-3 | teste-6 | teste-7a>
 *
 * Os testes 3, 6 e 7a rodam a cadeia com `--ref` num ramo que quebra o site de
 * um jeito só. As mudanças estão aqui, e não descritas à mão, para que o ensaio
 * local (`scripts/test-local.mjs`) e o teste no GitHub quebrem o site do mesmo
 * jeito. O script só troca o texto; criar o ramo, commitar e enviar é do dono.
 *
 *   teste-3   o sha da release, na página, passa a ser escrito à mão (b9abf7e,
 *             o da v0.5.0) em vez de lido da ficha. Coincide com a ficha de
 *             hoje; com qualquer ficha nova, diverge;
 *   teste-6   a versão aparece no rodapé, como texto visível;
 *   teste-7a  `scripts/ficha.mjs` passa a escrever também um verbete de
 *             novidade, além dos dois arquivos da ficha.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const MUTACOES = {
  "teste-3": [{ arquivo: "src/pagina.html", de: "{{ficha:sha7}}", para: "b9abf7e" }],
  "teste-6": [{ arquivo: "src/pagina.html", de: "<p>shz-teste-site</p>", para: "<p>shz-teste-site v0.5.0</p>" }],
  "teste-7a": [
    {
      arquivo: "scripts/ficha.mjs",
      de: "writeFileSync(DESTINO, bytes);",
      para: 'writeFileSync(DESTINO, bytes);\nwriteFileSync(path.join(RAIZ, "src/content/verbete-novidade.md"), "# novidade\\n");',
    },
  ],
};

export function aplicar(raiz, teste) {
  const mudancas = MUTACOES[teste];
  if (!mudancas) throw new Error(`preparar-ramo: teste desconhecido "${teste}". Use: ${Object.keys(MUTACOES).join(", ")}`);
  for (const { arquivo, de, para } of mudancas) {
    const p = path.join(raiz, arquivo);
    const antes = readFileSync(p, "utf8");
    if (!antes.includes(de)) throw new Error(`preparar-ramo: "${de}" não está em ${arquivo} (o ramo já foi preparado?)`);
    writeFileSync(p, antes.replace(de, para));
  }
  return mudancas.map((m) => m.arquivo);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const arquivos = aplicar(RAIZ, process.argv[2]);
    console.log(`preparar-ramo: ${process.argv[2]} aplicado em ${arquivos.join(", ")}. Resultado: OK`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
