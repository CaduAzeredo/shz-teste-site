# shz-teste-site

Test bed for the Shizune release-to-site chain. Not a real site.

Bancada de teste da cadeia release → site do Shizune. Não é um site de verdade: é o mínimo que os oito testes negativos da cadeia precisam, antes de ela chegar ao shizune.dev e à caduazeredo.com.

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `src/content/ficha-release.json` | A ficha da release, cópia byte a byte do `shizune-release.json` anexado à release (hoje, a da v0.5.0) |
| `src/content/release-mais-recente.json` | O sha da release mais recente; quando diverge do sha da ficha, a página liga a faixa "desatualizada" |
| `src/pagina.html` | A única página. Todo número vem de um `{{ficha:<campo>}}` |
| `scripts/ficha.mjs` | Cópia sem mudança do `scripts/ficha.mjs` do shizune.dev (commit `0654d28`): copia a ficha e grava o sha |
| `scripts/build.mjs` | Monta `dist/index.html` da ficha. A versão vai só para o JSON-LD |
| `scripts/portao.mjs` | O portão: reprova número divergente da ficha e versão no texto visível |
| `scripts/test-local.mjs` | Ensaio local: roda os passos de verdade do workflow numa cópia temporária (testes 3, 6, 7a; com `--rede`, o 8) |
| `scripts/preparar-ramo.mjs` | Aplica a mudança de cada ramo de teste (3, 6, 7a), a mesma do ensaio local |
| `scripts/assinantes.mjs` | Escreve `.github/assinantes-do-pacote` só com a chave humana |
| `scripts/conferir-workflows.py` | Conferência dos workflows na falta do `actionlint` (PyYAML, SHAs, referências, `bash -n`) |
| `.github/workflows/cadeia-ficha.yml` | A cadeia, cópia do rascunho do Brain, com as actions fixadas por SHA |
| `.github/workflows/sonda-token.yml` | A sonda dos testes 4 e 5. Sai depois dos testes |

## Comandos

```bash
bun run portao
```

```bash
node scripts/test-local.mjs
```

```bash
python scripts/conferir-workflows.py
```

O roteiro dos oito testes, com o estado de cada um, está no Brain, em `projects/brain-launch/cadeia/roteiro-dos-oito.md`.
