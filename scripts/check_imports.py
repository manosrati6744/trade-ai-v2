#!/usr/bin/env python3
"""Verify every import in src/ resolves to a real file or a declared dependency.
Catches the exact failure class Vercel reports as 'Module not found'."""
import json, os, re, sys

ROOT = '/home/z/my-project'
SRC = os.path.join(ROOT, 'src')

NODE_BUILTINS = {
    'assert','buffer','child_process','cluster','console','constants','crypto','dgram','dns',
    'domain','events','fs','http','https','inspector','module','net','os','path','perf_hooks',
    'process','punycode','querystring','readline','repl','stream','string_decoder','sys','timers',
    'tls','trace_events','tty','url','util','v8','vm','wasi','worker_threads','zlib',
}

pkg = json.load(open(os.path.join(ROOT, 'package.json')))
declared = set(pkg.get('dependencies', {})) | set(pkg.get('devDependencies', {}))

spec_re = re.compile(
    r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']"""
)

def resolve(spec, importer):
    if spec.startswith('@/'):
        base = os.path.join(ROOT, 'src', spec[2:])
    elif spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    else:
        return None  # handled separately (bare)
    cands = [base] + [base + ext for ext in ('.ts', '.tsx', '.js', '.jsx', '.json', '.css')]
    cands += [os.path.join(base, 'index' + ext) for ext in ('.ts', '.tsx', '.js')]
    return next((c for c in cands if os.path.isfile(c)), None)

def bare_ok(spec):
    if spec.startswith('node:') or spec.split('/')[0] in NODE_BUILTINS:
        return True
    base = spec.split('/')[0]
    if base.startswith('@'):
        base = '/'.join(spec.split('/')[:2])  # scoped package
    return base in declared

problems, n_files, n_specs = [], 0, 0
for dirpath, _, files in os.walk(SRC):
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        p = os.path.join(dirpath, fn)
        n_files += 1
        text = open(p, encoding='utf-8', errors='replace').read()
        for spec in spec_re.findall(text):
            if spec.startswith(('http://', 'https://')):
                continue
            n_specs += 1
            if spec.startswith(('@/', '.')):
                if resolve(spec, p) is None:
                    problems.append(f'{os.path.relpath(p, ROOT)}: cannot resolve "{spec}"')
            elif not bare_ok(spec):
                problems.append(f'{os.path.relpath(p, ROOT)}: package "{spec}" not in package.json')

print(f'scanned {n_files} files, {n_specs} import specifiers')
if problems:
    print('UNRESOLVED IMPORTS:')
    print('\n'.join('  ' + x for x in problems))
    sys.exit(1)
print('ALL IMPORTS RESOLVE ✔')
