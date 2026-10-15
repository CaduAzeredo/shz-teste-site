#!/usr/bin/env python3
"""Conferência dos workflows deste repositório, na falta do actionlint.

uso: python scripts/conferir-workflows.py   (precisa do PyYAML e do bash)

Não substitui o actionlint: ele não conhece o esquema inteiro do GitHub Actions
nem roda o shellcheck. Confere o que a cadeia depende de estar certo:

  1. o YAML abre (PyYAML, safe_load);
  2. todo `uses:` de action remota está fixado por SHA de 40 hex;
  3. cada passo tem `uses:` ou `run:`, nunca os dois nem nenhum;
  4. os `id:` dos passos não se repetem, e todo `steps.<id>.outputs` citado
     aponta para um passo que existe ANTES dele no mesmo job;
  5. todo `inputs.<nome>` citado está declarado no `workflow_dispatch`;
  6. as chaves de `permissions:` são escopos que existem, com read/write/none;
  7. todo `${{` fecha com `}}`;
  8. o corpo de cada `run:` passa no `bash -n` (sintaxe do shell), com cada
     expressão `${{ ... }}` trocada por uma palavra neutra antes.

Sai com 1 se qualquer item falhar.
"""
import glob
import os
import re
import subprocess
import sys

import yaml

# o console do Windows não é UTF-8 por padrão, e a saída tem acentos
sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASH = os.environ.get("BASH_CMD") or ("C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else "bash")
SHA = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
ESCOPOS = {
    "actions", "attestations", "checks", "contents", "deployments", "discussions", "id-token",
    "issues", "models", "packages", "pages", "pull-requests", "repository-projects",
    "security-events", "statuses",
}
EXPR = re.compile(r"\$\{\{(.*?)\}\}", re.S)

falhas = []
oks = []


def falha(arquivo, msg):
    falhas.append(f"{arquivo}: {msg}")


def expressoes(texto):
    return [m.group(1) for m in EXPR.finditer(texto)]


for caminho in sorted(glob.glob(os.path.join(RAIZ, ".github", "workflows", "*.yml"))):
    nome = os.path.relpath(caminho, RAIZ).replace("\\", "/")
    with open(caminho, encoding="utf-8") as f:
        texto = f.read()

    try:
        doc = yaml.safe_load(texto)
    except yaml.YAMLError as e:
        falha(nome, f"o YAML não abre: {e}")
        continue
    oks.append(f"{nome}: o YAML abre")

    # o PyYAML lê a chave `on` como o booleano True (YAML 1.1)
    gatilhos = doc.get("on", doc.get(True)) or {}
    declarados = set(((gatilhos.get("workflow_dispatch") or {}).get("inputs") or {}).keys()) if isinstance(gatilhos, dict) else set()

    if texto.count("${{") != len(expressoes(texto)):
        falha(nome, "há `${{` sem `}}`")

    for expr in expressoes(texto):
        for entrada in re.findall(r"\binputs\.([A-Za-z0-9_-]+)", expr):
            if entrada not in declarados:
                falha(nome, f"`inputs.{entrada}` citado e não declarado no workflow_dispatch")

    for escopo, valor in (doc.get("permissions") or {}).items():
        if escopo not in ESCOPOS or valor not in ("read", "write", "none"):
            falha(nome, f"permissions: `{escopo}: {valor}` não é escopo/valor válido")

    for job_id, job in (doc.get("jobs") or {}).items():
        vistos = []
        for i, passo in enumerate(job.get("steps") or [], 1):
            rotulo = passo.get("name") or passo.get("uses") or f"passo {i}"
            tem_uses, tem_run = "uses" in passo, "run" in passo
            if tem_uses == tem_run:
                falha(nome, f"{job_id} / {rotulo}: precisa de `uses:` ou `run:`, um só")
            if tem_uses and not passo["uses"].startswith("./") and not SHA.match(passo["uses"]):
                falha(nome, f"{job_id} / {rotulo}: `{passo['uses']}` não está fixado por SHA")
            for expr in expressoes(yaml.safe_dump(passo, allow_unicode=True)):
                for ref in re.findall(r"\bsteps\.([A-Za-z0-9_-]+)\.", expr):
                    if ref not in vistos:
                        falha(nome, f"{job_id} / {rotulo}: cita `steps.{ref}` antes de ele existir")
            if "id" in passo:
                if passo["id"] in vistos:
                    falha(nome, f"{job_id}: `id: {passo['id']}` repetido")
                vistos.append(passo["id"])
            if tem_run:
                corpo = EXPR.sub("EXPRESSAO", passo["run"])
                r = subprocess.run([BASH, "-n"], input=corpo, capture_output=True, text=True, encoding="utf-8")
                if r.returncode != 0:
                    falha(nome, f"{job_id} / {rotulo}: bash -n reprova: {r.stderr.strip()}")
        usos = [p["uses"] for p in job.get("steps") or [] if "uses" in p]
        fixadas = [u for u in usos if SHA.match(u)]
        oks.append(f"{nome}: job `{job_id}`, {len(job.get('steps') or [])} passos, {len(fixadas)} de {len(usos)} action(s) fixada(s) por SHA, bash -n em cada run")

print("conferir-workflows — sem actionlint: PyYAML + regras da cadeia + bash -n\n")
for o in oks:
    print(f"  ok    {o}")
for f in falhas:
    print(f"  FALHA {f}")
if falhas:
    print(f"\nconferir-workflows: Resultado: FALHA — {len(falhas)} problema(s).")
    sys.exit(1)
print("\nconferir-workflows: Resultado: OK")
